import type { AddressInfo } from "node:net";
import { dayPhase, rainAt, type ClientMsg, type HouseSummary, type LifeIntent, type LifeState, type ServerMsg } from "@cg/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app";
import { openSqlite } from "../persistence/node-sqlite";

class Player {
  inbox: ServerMsg[] = [];
  last: LifeState | null = null;
  ws!: WebSocket;
  private waiters: (() => void)[] = [];
  constructor(
    private url: string,
    readonly houseId: string,
    readonly cookie: string,
  ) {}
  connect() {
    this.inbox = [];
    this.ws = new WebSocket(`${this.url}?house=${this.houseId}`, { headers: { cookie: this.cookie } });
    this.ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      if (m.type === "life" || m.type === "welcome") this.last = m.life;
      this.inbox.push(m);
      this.waiters.splice(0).forEach((w) => w());
    });
    this.ws.on("open", () => this.send({ type: "hello", knownVersion: 0 }));
    return this.next("welcome");
  }
  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }
  intent(intent: LifeIntent) {
    this.send({ type: "life", intent });
  }
  async next<T extends ServerMsg["type"]>(type: T, match: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true) {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && match(m as Extract<ServerMsg, { type: T }>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { type: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  async disconnect() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((r) => {
      this.ws.once("close", () => r());
      this.ws.close();
    });
  }
}

let db: ReturnType<typeof openSqlite>;
let app: ReturnType<typeof createApp>;
let base: string;

async function call(method: string, path: string, body?: unknown, cookie = "") {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie: set ? set.split(";")[0]! : "" };
}
async function signUp(name: string) {
  const r = await call("POST", "/api/account", { name, password: "correct horse" });
  expect(r.status).toBe(201);
  return r.cookie;
}
async function couple() {
  const ana = await signUp("Ana");
  const ben = await signUp("Ben");
  const made = (await call("POST", "/api/houses", { houseName: "Rainy house" }, ana)).body as unknown as HouseSummary;
  expect((await call("POST", "/api/join", { code: made.inviteCode }, ben)).status).toBe(200);
  const url = `${base.replace("http", "ws")}/ws`;
  return { a: new Player(url, made.houseId, ana), b: new Player(url, made.houseId, ben), houseId: made.houseId, ana, ben };
}
function startApp() {
  app = createApp({ directory: db.directory, houses: db.houses });
  return new Promise<void>((r) =>
    app.http.listen(0, () => {
      base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
      r();
    }),
  );
}
beforeEach(async () => {
  db = openSqlite(":memory:");
  await startApp();
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe("the shared day, over the wire", () => {
  it("jumps both players to the same time, and keeps it through reconnects and a restart", async () => {
    const { a, b, houseId, ana } = await couple();
    await a.connect();
    const b0 = await b.connect();
    // before anyone touches it, it's just the server's own clock
    expect(b0.life.world).toBeUndefined();

    a.intent({ do: "world", cmd: { cmd: "time", at: "midnight" } });
    const seen = await b.next("life", (m) => m.life.world !== undefined);
    expect(dayPhase(seen.now, seen.life.world)).toBeCloseTo(0.75, 2);
    await a.next("life", (m) => m.life.world !== undefined);
    expect(a.last!.world).toEqual(b.last!.world);

    // a refresh (disconnect, connect again) lands on the same moment of the day, not back at the start
    await b.disconnect();
    const again = await b.connect();
    expect(dayPhase(again.now, again.life.world)).toBeCloseTo(0.75, 1);

    await new Promise((r) => setTimeout(r, 2200));
    await a.disconnect();
    await b.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const old = app;
    await startApp();
    const back = new Player(`${base.replace("http", "ws")}/ws`, houseId, ana);
    const w = await back.connect();
    expect(dayPhase(w.now, w.life.world)).toBeCloseTo(0.75, 1);
    await back.disconnect();
    await old.close();
  });

  it("changes nothing when asked for the moment it already is", async () => {
    const { a } = await couple();
    await a.connect();
    a.intent({ do: "world", cmd: { cmd: "time", at: "noon" } });
    await a.next("life", (m) => m.life.world !== undefined);
    const before = JSON.stringify(a.last!.world);
    a.intent({ do: "world", cmd: { cmd: "time", at: "noon" } });
    await new Promise((r) => setTimeout(r, 200));
    expect(JSON.stringify(a.last!.world)).toBe(before);
    await a.disconnect();
  });

  it("syncs forced rain to both players without moving the clock, and keeps it through reconnects and a restart", async () => {
    const { a, b, houseId, ana } = await couple();
    await a.connect();
    await b.connect();
    a.intent({ do: "world", cmd: { cmd: "time", at: "midnight" } });
    await b.next("life", (m) => m.life.world !== undefined);
    const midnightShift = a.last!.world?.dayShift ?? (await a.next("life", (m) => m.life.world !== undefined)).life.world!.dayShift;

    // rain at night, forced by one of them: both see the same, and the day's clock is exactly where it was
    b.intent({ do: "world", cmd: { cmd: "weather", set: "rain" } });
    const seen = await a.next("life", (m) => m.life.world?.weather?.mode === "rain");
    await b.next("life", (m) => m.life.world?.weather?.mode === "rain");
    expect(seen.life.world!.dayShift).toBe(midnightShift);
    expect(dayPhase(seen.now, seen.life.world)).toBeCloseTo(0.75, 1);
    expect(a.last!.world).toEqual(b.last!.world);
    expect(rainAt(seen.now + 8000, seen.life.world)).toBeGreaterThan(0.99);

    // a refresh lands in the same rain, at the same hour
    await b.disconnect();
    const again = await b.connect();
    expect(again.life.world?.weather?.mode).toBe("rain");
    expect(dayPhase(again.now, again.life.world)).toBeCloseTo(0.75, 1);
    expect(rainAt(again.now + 8000, again.life.world)).toBeGreaterThan(0.99);

    // clearing it by hand, then a server restart: still clear, still night
    a.intent({ do: "world", cmd: { cmd: "weather", set: "clear" } });
    await b.next("life", (m) => m.life.world?.weather?.mode === "clear");
    await new Promise((r) => setTimeout(r, 2200));
    await a.disconnect();
    await b.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const old = app;
    await startApp();
    const back = new Player(`${base.replace("http", "ws")}/ws`, houseId, ana);
    const w = await back.connect();
    expect(w.life.world?.weather?.mode).toBe("clear");
    expect(rainAt(w.now + 8000, w.life.world)).toBeLessThan(0.01);
    expect(dayPhase(w.now, w.life.world)).toBeCloseTo(0.75, 1);
    await back.disconnect();
    await old.close();
  });
});
