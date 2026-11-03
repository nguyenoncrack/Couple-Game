import { CLOSE, type ClientMsg, type ServerMsg } from "@cg/shared";

export interface ConnectionHandlers {
  /** Version to ask the server to catch up from (0 = send everything). */
  knownVersion(): number;
  onMessage(msg: ServerMsg): void;
  onStatus(status: "connecting" | "online" | "reconnecting" | "asleep"): void;
  /** The server won't let us back in (not a member, house gone, or this player opened the house elsewhere). */
  onFatal(code: number): void;
}

/** A tab hidden this long lets go of the house, so a forgotten tab doesn't keep it awake. */
const HIDDEN_MS = 5 * 60_000;

/**
 * The house WebSocket. Reconnects with backoff on its own; the game state decides what to resend after each
 * `welcome`. Messages sent while not connected are dropped (ops stay pending in the game state and are resent).
 * It goes to sleep when the server closes an idle house or the tab stays hidden, and wakes when you come back.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private welcomed = false;
  private attempts = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private hiddenTimer: number | undefined;
  private disposed = false;
  private asleep = false;

  constructor(
    private houseId: string,
    private h: ConnectionHandlers,
  ) {
    document.addEventListener("visibilitychange", this.onVisibility);
    this.open();
  }

  private onVisibility = () => {
    window.clearTimeout(this.hiddenTimer);
    if (document.hidden) this.hiddenTimer = window.setTimeout(() => this.sleep(), HIDDEN_MS);
    else this.wake();
  };

  private open() {
    if (this.disposed || this.asleep) return;
    this.h.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?house=${encodeURIComponent(this.houseId)}`);
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => this.raw({ type: "hello", knownVersion: this.h.knownVersion() });
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
      if (e.code === CLOSE.idle) {
        this.asleep = true;
        this.h.onStatus("asleep");
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

  /** Let go of the house until `wake`. */
  sleep() {
    if (this.disposed || this.asleep) return;
    this.asleep = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    this.welcomed = false;
    ws?.close();
    this.h.onStatus("asleep");
  }

  wake() {
    if (this.disposed || !this.asleep) return;
    this.asleep = false;
    this.attempts = 0;
    this.open();
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.clearTimeout(this.hiddenTimer);
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
