import { CLOSE } from "@cg/shared";
import { sameOrigin, signedIn } from "@cg/server/auth/session";
import { createApi } from "@cg/server/http/api";
import { createTables, DIRECTORY_SCHEMA, HOUSE_SCHEMA, type Row, type Sql, type SqlValue } from "@cg/server/persistence/sql";
import { SqlDirectory, SqlHouseStore } from "@cg/server/persistence/sql-stores";
import type { HouseRow, MemberRow, Snapshot } from "@cg/server/persistence/store";
import { RateLimiter } from "@cg/server/rate-limit";
import { HouseRoom } from "@cg/server/rooms/house-room";
import { MAX_MESSAGE, serveSocket } from "@cg/server/rooms/socket";
import { DurableObject } from "cloudflare:workers";

/**
 * The game on Cloudflare. The same rooms and stores as the Node server, arranged differently: one Durable Object
 * (the directory) holds accounts, sign-ins and who's in which house, and answers the API; each house is a Durable
 * Object of its own that runs its room while someone is in it. This Worker sends requests to the right one, and
 * the website itself is served as static assets.
 */

interface Env {
  DIRECTORY: DurableObjectNamespace<DirectoryDO>;
  HOUSE: DurableObjectNamespace<HouseDO>;
  ASSETS: Fetcher;
  PASSWORD_ROUNDS?: string;
}

const directory = (env: Env) => env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
const house = (env: Env, houseId: string) => env.HOUSE.get(env.HOUSE.idFromName(houseId));

/** A Durable Object's built-in SQLite, as the stores expect it. */
function durableSql(storage: DurableObjectStorage): Sql {
  const exec = (q: string, a: SqlValue[]) => storage.sql.exec(q, ...a).toArray() as Row[];
  return {
    run: (q, ...a) => void exec(q, a),
    all: <T = Row>(q: string, ...a: SqlValue[]) => exec(q, a) as T[],
    get: <T = Row>(q: string, ...a: SqlValue[]) => exec(q, a)[0] as T | undefined,
    tx: (fn) => storage.transactionSync(fn),
  };
}

type Pass = { ok: true; memberId: string; house: HouseRow } | { ok: false; code: number; reason: string };

/** Accounts, sign-ins and houses, for everyone: one of these for the whole game. */
export class DirectoryDO extends DurableObject<Env> {
  private directory: SqlDirectory;
  private api: ReturnType<typeof createApi>;
  private connectLimit = new RateLimiter(20, 20 / 60);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = durableSql(ctx.storage);
    createTables(sql, DIRECTORY_SCHEMA);
    this.directory = new SqlDirectory(sql);
    this.api = createApi({
      directory: this.directory,
      appearanceChanged: async (id) => {
        const houses = await this.directory.housesFor(id);
        await Promise.all(houses.map((h) => house(env, h.house.id).refreshAppearance(id)));
      },
      initHouse: (id, snap) => house(env, id).init(id, snap),
      dropHouse: (id) => house(env, id).drop(id),
      passwordRounds: env.PASSWORD_ROUNDS ? Number(env.PASSWORD_ROUNDS) : undefined,
    });
  }

  /** API requests, sent on by the Worker with the caller's address in `x-cg-ip`. */
  async fetch(req: Request) {
    return (await this.api(req, req.headers.get("x-cg-ip") ?? "")) ?? new Response("Not found", { status: 404 });
  }

  /** May this request's sign-in connect to this house? */
  async authorize(cookie: string | null, origin: string | null, host: string | null, houseId: string, ip: string): Promise<Pass> {
    if (!this.connectLimit.take(ip)) return { ok: false, code: CLOSE.busy, reason: "too many attempts" };
    if (!sameOrigin(origin, host)) return { ok: false, code: CLOSE.unauthorized, reason: "wrong origin" };
    const who = await signedIn(this.directory, cookie);
    const member = who && (await this.directory.memberFor(houseId, who.account.id));
    if (!member) return { ok: false, code: CLOSE.unauthorized, reason: "not a member" };
    const row = await this.directory.getHouse(houseId);
    if (!row) return { ok: false, code: CLOSE.notFound, reason: "no such house" };
    return { ok: true, memberId: member.id, house: row };
  }

  async listMembers(houseId: string): Promise<MemberRow[]> {
    return this.directory.listMembers(houseId);
  }
}

/** A connection gets dropped once it's this quiet (the game pings every 15 seconds). */
const SILENT_MS = 50_000;

/** One house: its saved blueprint and life, and its room while someone is in it. */
export class HouseDO extends DurableObject<Env> {
  private store: SqlHouseStore;
  private room: Promise<HouseRoom> | null = null;
  private dropped = false;
  /** Open sockets and when each was last heard from. */
  private heard = new Map<WebSocket, number>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = durableSql(ctx.storage);
    createTables(sql, HOUSE_SCHEMA);
    this.store = new SqlHouseStore(sql);
  }

  /** Refresh an active room only; sleeping rooms read cosmetics when next opened. */
  async refreshAppearance(accountId: string) {
    const active = await this.room;
    await active?.refreshAppearance(accountId);
  }

  /** A brand-new house's first snapshot. */
  async init(houseId: string, snapshot: Snapshot) {
    await this.store.saveSnapshot(houseId, snapshot);
  }

  /** The last person left: forget everything. */
  async drop(houseId: string) {
    this.dropped = true;
    const room = await this.room?.catch(() => null);
    this.room = null;
    room?.closeAll(CLOSE.notFound, "house deleted");
    await this.store.deleteHouse(houseId);
  }

  /** A player's WebSocket, already checked by the directory (the Worker sets who and which house). */
  async fetch(req: Request) {
    const memberId = req.headers.get("x-cg-member");
    const row = JSON.parse(req.headers.get("x-cg-house") ?? "null") as HouseRow | null;
    if (!memberId || !row || this.dropped) return new Response("Not found", { status: 404 });

    this.room ??= HouseRoom.load(row, this.store, () => directory(this.env).listMembers(row.id));
    let room: HouseRoom;
    try {
      room = await this.room;
    } catch (e) {
      this.room = null;
      throw e;
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    let open = true;
    const gone = () => {
      if (!open) return;
      open = false;
      this.heard.delete(server);
      handler.closed();
      void this.released();
    };
    const handler = serveSocket(room, memberId, {
      send: (data) => {
        if (open) server.send(data);
      },
      close: (code, reason) => {
        try {
          server.close(code, reason);
        } catch {
          // already closing
        }
        gone();
      },
    });
    server.addEventListener("message", (e) => {
      this.heard.set(server, Date.now());
      const data = typeof e.data === "string" ? e.data : "";
      if (data.length > MAX_MESSAGE) return server.close(1009, "message too large");
      handler.message(data).catch((err) => {
        console.error("[ws]", err);
        server.close(1011, "server error");
        gone();
      });
    });
    server.addEventListener("close", () => {
      try {
        server.close(1000, "bye");
      } catch {
        // already closed
      }
      gone();
    });
    server.addEventListener("error", gone);
    this.heard.set(server, Date.now());
    this.watch();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Drop connections that stopped talking (laptop lid closed, network gone), so presence and holds clear. */
  private watch() {
    this.heartbeat ??= setInterval(() => {
      const now = Date.now();
      for (const [ws, at] of this.heard) if (now - at > SILENT_MS) ws.close(1001, "not heard from");
      if (!this.heard.size && this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    }, 20_000);
  }

  /** Someone left: once nobody's here, save, so the house can sleep (Cloudflare unloads it when it's quiet). */
  private async released() {
    const room = await this.room?.catch(() => null);
    if (room?.isEmpty && !this.dropped) await room.flush();
  }
}

/** Refuse a WebSocket in a way the browser can read: open it, then close it with our code. */
function refuse(code: number, reason: string) {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") ?? "";

    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers(req.headers);
      headers.set("x-cg-ip", ip);
      return directory(env).fetch(new Request(req, { headers }));
    }

    if (url.pathname === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const houseId = url.searchParams.get("house") ?? "";
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(houseId)) return refuse(CLOSE.notFound, "no such house");
      const pass = await directory(env).authorize(req.headers.get("cookie"), req.headers.get("origin"), req.headers.get("host"), houseId, ip);
      if (!pass.ok) return refuse(pass.code, pass.reason);
      // only these two headers reach the house, and only the Worker sets them
      const headers = new Headers({ upgrade: "websocket", "x-cg-member": pass.memberId, "x-cg-house": JSON.stringify(pass.house) });
      return house(env, houseId).fetch(new Request(req.url, { headers }));
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
