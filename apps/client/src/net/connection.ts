import { CLOSE, type ClientMsg, type ServerMsg } from "@cg/shared";

export interface ConnectionHandlers {
  /** Version to ask the server to catch up from (0 = send everything). */
  knownVersion(): number;
  onMessage(msg: ServerMsg): void;
  onStatus(status: "connecting" | "online" | "reconnecting"): void;
  /** The server won't let us back in (not a member, house gone, or this player opened the house elsewhere). */
  onFatal(code: number): void;
}

/**
 * The house WebSocket. Reconnects with backoff on its own; the game state decides what to resend after each
 * `welcome`. Messages sent while not connected are dropped (ops stay pending in the game state and are resent).
 */
export class Connection {
  private ws: WebSocket | null = null;
  private welcomed = false;
  private attempts = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private disposed = false;

  constructor(
    private houseId: string,
    private token: string,
    private h: ConnectionHandlers,
  ) {
    this.open();
  }

  private open() {
    if (this.disposed) return;
    this.h.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => this.raw({ type: "hello", houseId: this.houseId, token: this.token, knownVersion: this.h.knownVersion() });
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        this.welcomed = true;
        this.attempts = 0;
        this.h.onStatus("online");
      }
      this.h.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.welcomed = false;
      window.clearInterval(this.pingTimer);
      if (this.disposed) return;
      if (e.code === CLOSE.unauthorized || e.code === CLOSE.notFound || e.code === CLOSE.replaced) {
        this.disposed = true;
        this.h.onFatal(e.code);
        return;
      }
      this.attempts++;
      this.h.onStatus("reconnecting");
      const delay = Math.min(8000, 400 * 2 ** Math.min(this.attempts, 5)) * (0.75 + Math.random() * 0.5);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 15_000);
  }

  private raw(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Send once the server has welcomed us; otherwise drop. */
  send(msg: ClientMsg) {
    if (this.welcomed) this.raw(msg);
  }

  get ready() {
    return this.welcomed;
  }

  /** Something went out of step: reconnect and catch up from our known version. */
  resync() {
    this.ws?.close();
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
