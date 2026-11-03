import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { ClientMsg, CLOSE, type ServerMsg } from "@cg/shared";
import { WebSocketServer, type WebSocket } from "ws";
import { hashToken } from "./auth/tokens";
import { clientIp, createApi } from "./http/routes";
import type { Store } from "./persistence/store";
import { RateLimiter } from "./rate-limit";
import type { HouseRoom, Peer } from "./rooms/house-room";
import { Rooms } from "./rooms/rooms";

const HELLO_TIMEOUT_MS = 10_000;
const MAX_MESSAGE = 64 * 1024;

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
  store: Store;
  /** Built client to serve (production). */
  staticDir?: string;
  roomIdleMs?: number;
}

export function createApp({ store, staticDir, roomIdleMs }: AppOptions) {
  const rooms = new Rooms(store, roomIdleMs);
  const api = createApi(store);
  const helloLimit = new RateLimiter(20, 20 / 60);

  const http = createServer(async (req, res) => {
    if (await api(req, res)) return;
    if (staticDir) serveStatic(staticDir, req, res);
    else res.writeHead(404).end("Not found");
  });

  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_MESSAGE });

  wss.on("connection", (ws: WebSocket, req) => {
    const ip = clientIp(req);
    const send = (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    let room: HouseRoom | null = null;
    let peer: Peer | null = null;
    let busy = false;
    // Per-connection message budget: plenty for dragging and building, not enough to flood a room.
    const msgLimit = new RateLimiter(60, 30);
    const helloTimer = setTimeout(() => ws.close(CLOSE.unauthorized, "no hello"), HELLO_TIMEOUT_MS);

    ws.on("message", async (data) => {
      let msg: ClientMsg;
      try {
        msg = ClientMsg.parse(JSON.parse(String(data)));
      } catch {
        send({ type: "error", code: "invalid", message: "Couldn't read that message." });
        return;
      }
      if (!msgLimit.take("m")) {
        if (msg.type === "op") send({ type: "rejected", clientOpId: msg.clientOpId, reason: "rate-limited" });
        return;
      }

      if (msg.type === "hello") {
        if (peer || busy) return;
        busy = true;
        clearTimeout(helloTimer);
        if (!helloLimit.take(ip)) return ws.close(CLOSE.unauthorized, "too many attempts");
        const member = await store.memberByToken(msg.houseId, hashToken(msg.token));
        if (!member) return ws.close(CLOSE.unauthorized, "not a member");
        room = await rooms.get(msg.houseId);
        if (!room) return ws.close(CLOSE.notFound, "no such house");
        if (ws.readyState !== ws.OPEN) return;
        peer = { memberId: member.id, send, close: (code, reason) => ws.close(code, reason) };
        await room.join(peer, msg.knownVersion);
        return;
      }
      if (!room || !peer) return;
      switch (msg.type) {
        case "op":
          await room.submit(peer, msg.clientOpId, msg.op);
          break;
        case "hold":
          room.hold(peer, msg.objectId);
          break;
        case "presence":
          room.setPresence(peer, { cursor: msg.cursor, tool: msg.tool, drag: msg.drag });
          break;
        case "ping":
          send({ type: "pong" });
          break;
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (room && peer) {
        room.leave(peer);
        void rooms.released(room.house.id);
      }
    });
    ws.on("error", () => {});
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
