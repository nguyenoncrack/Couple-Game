import { ClientMsg, type ServerMsg } from "@cg/shared";
import { RateLimiter } from "../rate-limit";
import type { HouseRoom, Peer } from "./house-room";

/** Largest message a client may send; a whole-house edit fits easily. */
export const MAX_MESSAGE = 64 * 1024;

/** What a socket handler needs from the WebSocket it serves, whichever server it runs on. */
export interface SocketIO {
  send(data: string): void;
  close(code: number, reason: string): void;
}

/**
 * One player's connection to a house, after they've been signed in and checked as a member. The first message must
 * be `hello`; after that it carries their edits, holds, presence and what their character does.
 */
export function serveSocket(room: HouseRoom, memberId: string, io: SocketIO) {
  // Per-connection message budget: plenty for dragging and building, not enough to flood a room.
  const limit = new RateLimiter(60, 30);
  const send = (msg: ServerMsg) => io.send(JSON.stringify(msg));
  let peer: Peer | null = null;
  let joining = false;
  let closed = false;

  return {
    async message(data: string) {
      let msg: ClientMsg;
      try {
        msg = ClientMsg.parse(JSON.parse(data));
      } catch {
        send({ type: "error", code: "invalid", message: "Couldn't read that message." });
        return;
      }
      if (!limit.take("m")) {
        if (msg.type === "op") send({ type: "rejected", clientOpId: msg.clientOpId, reason: "rate-limited" });
        return;
      }
      if (msg.type === "hello") {
        if (peer || joining) return;
        joining = true;
        const p: Peer = { memberId, send, close: (code, reason) => io.close(code, reason) };
        await room.join(p, msg.knownVersion);
        // gone while the room was letting them in: let them out again
        if (closed) room.leave(p);
        else peer = p;
        return;
      }
      if (!peer) return;
      if (msg.type === "ping") {
        send({ type: "pong", now: Date.now() });
        return;
      }
      room.touch();
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
        case "life":
          room.act(peer, msg.intent);
          break;
      }
    },

    closed() {
      closed = true;
      if (peer) room.leave(peer);
      peer = null;
    },
  };
}
