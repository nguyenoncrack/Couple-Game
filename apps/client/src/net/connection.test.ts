import { CLOSE } from "@cg/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "./connection";

/** Just enough of a browser WebSocket for the connection to drive. */
class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.drop(1005);
  }
  welcome() {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "welcome" }) });
  }
  drop(code: number, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const latest = () => FakeSocket.all.at(-1)!;

function connect() {
  const h = { knownVersion: () => 0, onMessage: vi.fn(), onStatus: vi.fn(), onFatal: vi.fn(), onUnsettled: vi.fn(), onDrop: vi.fn() };
  return { conn: new Connection("house1", h), h };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { protocol: "https:", host: "example.test" });
  vi.stubGlobal("document", { hidden: false, addEventListener() {}, removeEventListener() {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connection", () => {
  it("counts being dropped right after each welcome, and backs off instead of hammering", () => {
    const { conn, h } = connect();
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      latest().welcome();
      vi.advanceTimersByTime(200);
      const before = FakeSocket.all.length;
      latest().drop(1011, "server error");
      let waited = 0;
      while (FakeSocket.all.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      gaps.push(waited);
    }
    expect(h.onUnsettled.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4]);
    // the waits grow, as they would if the welcomes had never happened
    expect(gaps[3]!).toBeGreaterThan(gaps[0]! * 2);
    conn.dispose();
  });

  it("starts the count again once a connection settles in", () => {
    const { conn, h } = connect();
    latest().welcome();
    latest().drop(1011);
    vi.advanceTimersByTime(10_000);
    latest().welcome();
    vi.advanceTimersByTime(30_000);
    latest().drop(1006);
    vi.advanceTimersByTime(10_000);
    latest().welcome();
    latest().drop(1011);
    expect(h.onUnsettled.mock.calls.map((c) => c[0])).toEqual([1, 1]);
    conn.dispose();
  });

  it("waits a while when the server is busy, and doesn't send you home", () => {
    const { conn, h } = connect();
    const before = FakeSocket.all.length;
    latest().drop(CLOSE.busy, "too many attempts");
    vi.advanceTimersByTime(15_000);
    expect(FakeSocket.all.length).toBe(before);
    vi.advanceTimersByTime(6_000);
    expect(FakeSocket.all.length).toBe(before + 1);
    expect(h.onFatal).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenLastCalledWith("reconnecting");
    // and says why, for the reconnecting banner
    expect(h.onDrop).toHaveBeenCalledWith(CLOSE.busy, "too many attempts");
    conn.dispose();
  });

  it("still sends you home when you're not a member", () => {
    const { conn, h } = connect();
    latest().drop(CLOSE.unauthorized, "not a member");
    expect(h.onFatal).toHaveBeenCalledWith(CLOSE.unauthorized);
    conn.dispose();
  });
});
