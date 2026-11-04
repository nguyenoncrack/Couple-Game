import { AppearanceSchema, emptyBlueprint, newId, withStarterHouse, type Blueprint, type HouseSummary, type Me } from "@cg/shared";
import { z } from "zod";
import { DUMMY_HASH, hashPassword, hashToken, newInviteCode, newToken, normalizeInviteCode, verifyPassword } from "../auth/crypto";
import { clearedSessionCookie, sessionCookie, signedIn } from "../auth/session";
import { nameKey } from "../persistence/sql-stores";
import type { AccountRow, Directory, HouseRow, MemberRow, Snapshot } from "../persistence/store";
import { RateLimiter } from "../rate-limit";

/** The couple's two colours: whoever makes the house, then whoever joins. */
export const MEMBER_COLORS = ["#e07a5f", "#3d8fa3"] as const;
const MAX_MEMBERS = 2;
const MAX_BODY = 4 * 1024;

/** What the API needs from wherever it runs. */
export interface ApiDeps {
  directory: Directory;
  appearanceChanged?: (accountId: string) => Promise<void>;
  /** Give a brand-new house its first snapshot (on Cloudflare, in the house's own Durable Object). */
  initHouse(houseId: string, snapshot: Snapshot): Promise<void>;
  /** Forget a house's contents once its last member has left. */
  dropHouse(houseId: string): Promise<void>;
  /** PBKDF2 rounds for new passwords (default 100k, the most Cloudflare allows). */
  passwordRounds?: number;
}

const AccountName = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N} _.'-]+$/u);
const Password = z.string().min(8).max(200);
const HouseName = z.string().trim().min(1).max(24);
const Claims = z.array(z.object({ houseId: z.string().max(40), token: z.string().max(100) })).max(50);

const SignUp = z.object({ name: AccountName, password: Password, claims: Claims.optional() });
const SignIn = z.object({ name: z.string().max(60), password: z.string().max(200), claims: Claims.optional() });
const NewPassword = z.object({ current: z.string().max(200), next: Password });
const CreateBody = z.object({ houseName: HouseName, starter: z.boolean().optional() });
const JoinBody = z.object({ code: z.string().max(20) });
const ClaimBody = z.object({ claims: Claims });

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A new lot with the starter house already built (it's data, so this can't fail unless the data is wrong). */
function starterBlueprint(): Blueprint {
  return withStarterHouse(emptyBlueprint());
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}

async function body<T>(req: Request, schema: z.ZodType<T>, message = "Please check what you typed."): Promise<T> {
  // JSON only: an HTML form on another site can't send it without the browser asking us first
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "json-only", "Send JSON.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "too-large", "Request too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "bad-json", "That wasn't valid JSON.");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, "invalid", message);
  return r.data;
}

function summary(house: HouseRow, members: MemberRow[], accountId: string): HouseSummary {
  const me = members.find((m) => m.accountId === accountId)!;
  return {
    houseId: house.id,
    houseName: house.name,
    inviteCode: house.inviteCode,
    memberId: me.id,
    members: members.map((m) => ({ name: m.name, color: m.color, me: m.accountId === accountId })),
  };
}

/** JSON API: accounts and sign-in, your houses, making and joining houses. */
export function createApi({ directory, initHouse, dropHouse, passwordRounds, appearanceChanged }: ApiDeps) {
  const appearanceLimit = new RateLimiter(12, 0.5);
  const signUpLimit = new RateLimiter(5, 5 / 60);
  const signInLimit = new RateLimiter(10, 10 / 60);
  const createLimit = new RateLimiter(5, 5 / 60);
  const joinLimit = new RateLimiter(10, 10 / 60);

  async function me(account: AccountRow): Promise<Me> {
    const houses = await directory.housesFor(account.id);
    return { account: { ...account, appearance: await directory.getAppearance(account.id) }, houses: houses.map((h) => summary(h.house, h.members, account.id)) };
  }

  /** Houses this browser joined before accounts: each old token that checks out becomes this account's. */
  async function claim(account: AccountRow, claims: z.infer<typeof Claims> = []) {
    for (const c of claims) await directory.claimMember(c.houseId, await hashToken(c.token), account.id);
  }

  async function startSession(account: AccountRow, secure: boolean, status: number) {
    const token = newToken();
    await directory.createSession(await hashToken(token), account.id);
    return json(status, await me(account), { "set-cookie": sessionCookie(token, secure) });
  }

  async function signUp(req: Request, ip: string, secure: boolean) {
    if (!signUpLimit.take(ip)) throw new HttpError(429, "rate-limited", "Too many new accounts. Try again in a minute.");
    const b = await body(req, SignUp, "Names are 2 to 24 letters or numbers, and passwords at least 8 characters.");
    const account = { id: newId(12), name: b.name.replace(/\s+/g, " ") };
    if (!(await directory.createAccount(account, await hashPassword(b.password, passwordRounds)))) throw new HttpError(409, "name-taken", "That name is taken. Try another.");
    await claim(account, b.claims);
    return startSession(account, secure, 201);
  }

  async function signIn(req: Request, ip: string, secure: boolean) {
    const b = await body(req, SignIn);
    if (!signInLimit.take(ip) || !signInLimit.take(`name:${nameKey(b.name)}`)) throw new HttpError(429, "rate-limited", "Too many tries. Wait a minute and try again.");
    const found = await directory.accountByName(b.name);
    // check a password either way, so a wrong name takes as long as a wrong password
    const ok = await verifyPassword(b.password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !ok) throw new HttpError(401, "wrong", "That name and password don't match.");
    const account = { id: found.id, name: found.name };
    await claim(account, b.claims);
    return startSession(account, secure, 200);
  }

  async function changePassword(req: Request, who: { account: AccountRow; tokenHash: string }) {
    const b = await body(req, NewPassword, "New passwords need at least 8 characters.");
    const found = await directory.accountByName(who.account.name);
    if (!found || !(await verifyPassword(b.current, found.passwordHash))) throw new HttpError(401, "wrong", "Your current password isn't right.");
    await directory.setPassword(who.account.id, await hashPassword(b.next, passwordRounds));
    // anywhere else still signed in with the old password is signed out
    await directory.deleteOtherSessions(who.account.id, who.tokenHash);
    return json(200, { ok: true });
  }

  async function createHouse(req: Request, ip: string, account: AccountRow) {
    if (!createLimit.take(ip)) throw new HttpError(429, "rate-limited", "Too many new houses. Try again in a minute.");
    const b = await body(req, CreateBody, "Give the house a name (up to 24 letters).");
    const houseId = newId(12);
    await initHouse(houseId, { version: 0, blueprint: b.starter ? starterBlueprint() : emptyBlueprint() });
    const owner: MemberRow = { id: newId(12), houseId, accountId: account.id, name: account.name, color: MEMBER_COLORS[0], role: "owner" };
    // Codes are unique; on the rare clash, draw again.
    for (let attempt = 0; ; attempt++) {
      try {
        await directory.createHouse({ id: houseId, name: b.houseName, inviteCode: newInviteCode(), maxMembers: MAX_MEMBERS }, owner);
        break;
      } catch (e) {
        if (attempt >= 4 || !String(e).includes("invite_code")) throw e;
      }
    }
    return json(201, summary((await directory.getHouse(houseId))!, [owner], account.id));
  }

  async function join(req: Request, ip: string, account: AccountRow) {
    if (!joinLimit.take(ip)) throw new HttpError(429, "rate-limited", "Too many tries. Wait a minute and try again.");
    const b = await body(req, JoinBody);
    const code = normalizeInviteCode(b.code);
    const house = code ? await directory.findHouseByCode(code) : null;
    if (!house) throw new HttpError(404, "no-house", "No house has that code.");
    const members = await directory.listMembers(house.id);
    const member: MemberRow = { id: newId(12), houseId: house.id, accountId: account.id, name: account.name, color: MEMBER_COLORS[1], role: "partner" };
    // the second person gets whichever colour the first isn't using
    member.color = MEMBER_COLORS.find((c) => !members.some((m) => m.color === c)) ?? MEMBER_COLORS[1];
    const r = await directory.addMember(member);
    if (r === "full") throw new HttpError(409, "full", "This house already has two people in it.");
    return json(200, summary(house, await directory.listMembers(house.id), account.id));
  }

  async function leave(houseId: string, account: AccountRow) {
    if (!(await directory.memberFor(houseId, account.id))) throw new HttpError(404, "no-house", "You're not in that house.");
    if ((await directory.removeMember(houseId, account.id)) === 0) {
      await directory.deleteHouse(houseId);
      await dropHouse(houseId);
    }
    return json(200, { ok: true });
  }

  /** Handle an API request (`ip` is the client's address, for rate limits). Null if it isn't an API path. */
  return async function handle(req: Request, ip: string): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return null;
    const secure = url.protocol === "https:";
    const route = `${req.method} ${path}`;
    try {
      if (route === "GET /api/health") return json(200, { ok: true });
      if (route === "POST /api/account") return await signUp(req, ip, secure);
      if (route === "POST /api/session") return await signIn(req, ip, secure);

      const who = await signedIn(directory, req.headers.get("cookie"));
      if (route === "DELETE /api/session") {
        if (who) await directory.deleteSession(who.tokenHash);
        return json(200, { ok: true }, { "set-cookie": clearedSessionCookie(secure) });
      }
      if (!who) throw new HttpError(401, "signed-out", "Please sign in.");
      if (route === "GET /api/me") return json(200, await me(who.account));
      // the calendar: every day this player came by, oldest first (streaks are worked out on their own date)
      if (route === "GET /api/visits") return json(200, { visits: await directory.visitsFor(who.account.id) });
      if (route === "GET /api/account/appearance") return json(200, { appearance: await directory.getAppearance(who.account.id) });
      if (route === "PUT /api/account/appearance") {
        if (!appearanceLimit.take(who.account.id)) throw new HttpError(429, "rate-limited", "Give your last look a moment to save, then try again.");
        const appearance = await body(req, AppearanceSchema, "Choose one of the available character options.");
        await directory.setAppearance(who.account.id, appearance);
        // A disconnected house can pick up the saved look on its next join.
        try { await appearanceChanged?.(who.account.id); } catch (e) { console.warn("[appearance notification]", e); }
        return json(200, { appearance: await directory.getAppearance(who.account.id) });
      }
      if (route === "POST /api/account/password") return await changePassword(req, who);
      if (route === "POST /api/claims") {
        await claim(who.account, (await body(req, ClaimBody)).claims);
        return json(200, await me(who.account));
      }
      if (route === "POST /api/houses") return await createHouse(req, ip, who.account);
      if (route === "POST /api/join") return await join(req, ip, who.account);
      const leaving = req.method === "DELETE" && /^\/api\/houses\/([A-Za-z0-9_-]{6,40})$/.exec(path);
      if (leaving) return await leave(leaving[1]!, who.account);
      throw new HttpError(404, "not-found", "Not found.");
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
      console.error("[api]", e);
      return json(500, { error: "server", message: "Something went wrong on our side." });
    }
  };
}
