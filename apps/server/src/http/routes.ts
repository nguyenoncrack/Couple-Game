import type { IncomingMessage, ServerResponse } from "node:http";
import { applyOp, emptyBlueprint, newId, starterHouseOp, type Blueprint } from "@cg/shared";
import { z } from "zod";
import { hashToken, newInviteCode, newToken, normalizeInviteCode } from "../auth/tokens";
import type { Store } from "../persistence/store";
import { RateLimiter } from "../rate-limit";

/** The couple's two colours: whoever makes the house, then whoever joins. */
export const MEMBER_COLORS = ["#e07a5f", "#3d8fa3"] as const;
const MAX_MEMBERS = 2;
const MAX_BODY = 4 * 1024;

const name = z.string().trim().min(1).max(24);
const CreateBody = z.object({ houseName: name, playerName: name, starter: z.boolean().optional() });
/** A new lot with the starter house already built (it's data, so this can't fail unless the data is wrong). */
function starterBlueprint(): Blueprint {
  const r = applyOp(emptyBlueprint(), starterHouseOp());
  if (!r.ok) throw new Error(`starter house doesn't fit: ${r.reason}`);
  return r.blueprint;
}

const JoinBody = z.object({ code: z.string().max(20), playerName: name });

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "too-large", "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "bad-json", "That wasn't valid JSON.");
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "invalid", "Please check the names and code.");
  return r.data;
}

export const clientIp = (req: IncomingMessage) =>
  (process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "") || req.socket.remoteAddress || "unknown";

/** JSON API: make a house, join one by code, look one up. Returns false if the path isn't an API route. */
export function createApi(store: Store) {
  const createLimit = new RateLimiter(5, 5 / 60);
  const joinLimit = new RateLimiter(10, 10 / 60);

  async function createHouse(req: IncomingMessage) {
    if (!createLimit.take(clientIp(req))) throw new HttpError(429, "rate-limited", "Too many new houses. Try again in a minute.");
    const body = parse(CreateBody, await readJson(req));
    const houseId = newId(12);
    const token = newToken();
    const owner = { id: newId(12), houseId, name: body.playerName, color: MEMBER_COLORS[0], role: "owner" as const };
    // Codes are unique in the database; on the rare clash, draw again.
    for (let attempt = 0; ; attempt++) {
      try {
        await store.createHouse(
          { id: houseId, name: body.houseName, inviteCode: newInviteCode(), maxMembers: MAX_MEMBERS },
          { version: 0, blueprint: body.starter ? starterBlueprint() : emptyBlueprint() },
          owner,
          hashToken(token),
        );
        break;
      } catch (e) {
        if (attempt >= 4 || !String(e).includes("invite_code")) throw e;
      }
    }
    const house = (await store.getHouse(houseId))!;
    return { status: 201, body: { houseId, houseName: house.name, memberId: owner.id, token, inviteCode: house.inviteCode } };
  }

  async function join(req: IncomingMessage) {
    if (!joinLimit.take(clientIp(req))) throw new HttpError(429, "rate-limited", "Too many tries. Wait a minute and try again.");
    const body = parse(JoinBody, await readJson(req));
    const code = normalizeInviteCode(body.code);
    const house = code ? await store.findHouseByCode(code) : null;
    if (!house) throw new HttpError(404, "no-house", "No house has that code.");
    const members = await store.listMembers(house.id);
    const token = newToken();
    const member = { id: newId(12), houseId: house.id, name: body.playerName, color: MEMBER_COLORS[members.length] ?? MEMBER_COLORS[1], role: "partner" as const };
    if ((await store.addMember(member, hashToken(token))) === "full") throw new HttpError(409, "full", "This house already has two people in it.");
    return { status: 200, body: { houseId: house.id, houseName: house.name, memberId: member.id, token, inviteCode: house.inviteCode } };
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      let out: { status: number; body: unknown };
      if (req.method === "POST" && url.pathname === "/api/houses") out = await createHouse(req);
      else if (req.method === "POST" && url.pathname === "/api/join") out = await join(req);
      else if (req.method === "GET" && url.pathname === "/api/health") out = { status: 200, body: { ok: true } };
      else throw new HttpError(404, "not-found", "Not found.");
      send(res, out.status, out.body);
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.code, message: e.message });
      else {
        console.error("[api]", e);
        send(res, 500, { error: "server", message: "Something went wrong on our side." });
      }
    }
    return true;
  };
}
