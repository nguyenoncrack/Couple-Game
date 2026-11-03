import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { CLOSE } from "@cg/shared";
import { WebSocketServer, type WebSocket } from "ws";
import { sameOrigin, signedIn } from "./auth/session";
import { createApi } from "./http/api";
import type { Directory, HouseStore } from "./persistence/store";
import { RateLimiter } from "./rate-limit";
import { Rooms } from "./rooms/rooms";
import { MAX_MESSAGE, serveSocket } from "./rooms/socket";

const MAX_BODY = 8 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Serve the built client, falling back to index.html for app routes like /join/ABC-123. */
function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dir, safe);
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const immutable = file.includes(`${join(dir, "assets")}`);
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  createReadStream(file).pipe(res);
}

export interface AppOptions {
  directory: Directory;
  houses: HouseStore;
  /** Built client to serve (production). */
  staticDir?: string;
  roomIdleMs?: number;
  /** How long a house stays connected with nobody doing anything (default 30 minutes). */
  houseIdleMs?: number;
}

const clientIp = (req: IncomingMessage) =>
  (process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "") || req.socket.remoteAddress || "unknown";

/** A Node request as a standard `Request`, for the API (which also runs on Cloudflare). */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const proto = process.env.TRUST_PROXY ? String(req.headers["x-forwarded-proto"] ?? "http") : "http";
  const url = new URL(req.url ?? "/", `${proto}://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) break;
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  return new Request(url, { method: req.method, headers, body });
}

async function sendResponse(res: ServerResponse, r: Response) {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  const cookies = r.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

export function createApp({ directory, houses, staticDir, roomIdleMs, houseIdleMs }: AppOptions) {
  const rooms = new Rooms(directory, houses, roomIdleMs, houseIdleMs);
  const api = createApi({ directory, initHouse: (id, snap) => houses.saveSnapshot(id, snap), dropHouse: (id) => houses.deleteHouse(id) });
  const connectLimit = new RateLimiter(20, 20 / 60);

  const http = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      const out = await api(await toRequest(req), clientIp(req));
      if (out) return sendResponse(res, out);
    }
    if (staticDir) serveStatic(staticDir, req, res);
    else res.writeHead(404).end("Not found");
  });

  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_MESSAGE });

  wss.on("connection", (ws: WebSocket, req) => {
    // Who and where come with the connection: the sign-in cookie, and /ws?house=…. Messages that arrive while
    // that's being checked wait for it.
    const inbox: string[] = [];
    let handler: ReturnType<typeof serveSocket> | null = null;
    let houseId: string | null = null;
    ws.on("message", (data) => {
      if (handler) void handler.message(String(data));
      else inbox.push(String(data));
    });
    ws.on("close", () => {
      handler?.closed();
      if (houseId) void rooms.released(houseId);
    });
    ws.on("error", () => {});

    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      if (!connectLimit.take(clientIp(req))) return ws.close(CLOSE.unauthorized, "too many attempts");
      if (!sameOrigin(req.headers.origin, req.headers.host)) return ws.close(CLOSE.unauthorized, "wrong origin");
      const who = await signedIn(directory, req.headers.cookie);
      const id = url.searchParams.get("house") ?? "";
      const member = who && (await directory.memberFor(id, who.account.id));
      if (!member) return ws.close(CLOSE.unauthorized, "not a member");
      const room = await rooms.get(id);
      if (!room) return ws.close(CLOSE.notFound, "no such house");
      if (ws.readyState !== ws.OPEN) return void rooms.released(id);
      houseId = id;
      handler = serveSocket(room, member.id, {
        send: (data) => ws.readyState === ws.OPEN && ws.send(data),
        close: (code, reason) => ws.close(code, reason),
      });
      for (const m of inbox.splice(0)) await handler.message(m);
    })().catch((e) => {
      console.error("[ws]", e);
      ws.close(1011, "server error");
    });
  });

  // Drop connections that stop answering (laptop lid closed, network gone) so presence and holds clear.
  const alive = new WeakSet<WebSocket>();
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) ws.terminate();
      else {
        alive.delete(ws);
        ws.ping();
      }
    }
  }, 20_000);

  return {
    http,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.close(1001, "server restarting");
      wss.close();
      await rooms.flushAll();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
