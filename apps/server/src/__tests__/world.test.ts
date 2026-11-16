import type { AddressInfo } from "node:net";
import { cellsBetween, dayPhase, edgesBetween, rainAt, type ClientMsg, type HouseSummary, type LifeIntent, type LifeState, type Op, type ServerMsg } from "@cg/shared";
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
  op(id: string, op: Op) {
    this.send({ type: "op", clientOpId: id, op });
  }
  async next<T extends ServerMsg["type"]>(type: T, match: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true, ms = 3000) {
    const deadline = Date.now() + ms;
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

describe("the cozy catalog, over the wire", () => {
  it("saves, syncs and reloads cedar walls, rain slate, frosted windows and every cozy piece", async () => {
    const { a, b, houseId, ana } = await couple();
    await a.connect();
    await b.connect();
    const ops: Op[] = [
      ...[
        [4, 4, 12, 4],
        [12, 4, 12, 10],
        [12, 10, 4, 10],
        [4, 10, 4, 4],
      ].map(([x1, z1, x2, z2]) => ({ t: "walls.add" as const, level: 0, edges: edgesBetween(x1!, z1!, x2!, z2!), style: "cedar_planks" })),
      { t: "floor.paint", level: 0, cells: cellsBetween(4, 4, 11, 9), material: "slate_rain" },
      { t: "opening.place", level: 0, id: "frostwin001", catalogId: "window_frosted_wide", dir: "h", x: 7, z: 4, flip: false },
      { t: "object.place", level: 0, id: "benchcozy01", catalogId: "window_bench", x: 6, z: 5, rot: 0 },
      { t: "object.place", level: 0, id: "lampcozy001", catalogId: "reading_lamp", x: 10, z: 8, rot: 0 },
      { t: "object.place", level: 0, id: "basketcozy1", catalogId: "blanket_basket", x: 5, z: 8, rot: 0 },
      { t: "object.place", level: 0, id: "umbrellacz1", catalogId: "umbrella_stand", x: 9, z: 5, rot: 0 },
      { t: "object.place", level: 0, id: "teasetcozy1", catalogId: "tea_set_two", x: 8, z: 8, rot: 0 },
      { t: "object.place", level: 0, id: "rugcozy0001", catalogId: "rug_patterned", x: 6, z: 6, rot: 0 },
    ];
    ops.forEach((op, i) => a.op(`cozyop${String(i).padStart(4, "0")}`, op));
    for (let i = 0; i < ops.length; i++) await b.next("applied");

    // a refresh sees it all, with nothing rejected on the way
    await b.disconnect();
    const again = await b.connect();
    expect(again.sync.kind).toBe("snapshot");
    const bp = again.sync.kind === "snapshot" ? again.sync.state.blueprint : null;
    expect(Object.values(bp!.levels[0]!.objects).map((o) => o.catalogId).sort()).toEqual(["blanket_basket", "reading_lamp", "rug_patterned", "tea_set_two", "umbrella_stand", "window_bench"]);
    expect(Object.values(bp!.levels[0]!.openings).map((o) => o.catalogId)).toEqual(["window_frosted_wide"]);
    expect(Object.values(bp!.levels[0]!.walls).every((w) => w.style === "cedar_planks")).toBe(true);
    expect(Object.values(bp!.levels[0]!.tiles).every((t) => t.material === "slate_rain")).toBe(true);

    // and so does a server restart, which replays them from disk
    await new Promise((r) => setTimeout(r, 300));
    await a.disconnect();
    await b.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const old = app;
    await startApp();
    const back = new Player(`${base.replace("http", "ws")}/ws`, houseId, ana);
    const w = await back.connect();
    const restored = w.sync.kind === "snapshot" ? w.sync.state.blueprint : null;
    expect(Object.keys(restored!.levels[0]!.objects)).toHaveLength(6);
    expect(Object.keys(restored!.levels[0]!.openings)).toHaveLength(1);
    await back.disconnect();
    await old.close();
  });
});

describe("watching the rain, over the wire", () => {
  it("seats both players together on a window bench in the rain, through a refresh, and frees the seat when one gets up", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    // a room with a window in its north wall, the bench against it, and a door
    const ops: Op[] = [
      ...[
        [4, 4, 12, 4],
        [12, 4, 12, 10],
        [12, 10, 4, 10],
        [4, 10, 4, 4],
      ].map(([x1, z1, x2, z2]) => ({ t: "walls.add" as const, level: 0, edges: edgesBetween(x1!, z1!, x2!, z2!), style: "cedar_planks" })),
      { t: "floor.paint", level: 0, cells: cellsBetween(4, 4, 11, 9), material: "slate_rain" },
      { t: "opening.place", level: 0, id: "doorrainy01", catalogId: "door_wood", dir: "h", x: 10, z: 10, flip: false },
      { t: "opening.place", level: 0, id: "windowrain1", catalogId: "window_wide", dir: "h", x: 6, z: 4, flip: false },
      { t: "object.place", level: 0, id: "benchrainy1", catalogId: "window_bench", x: 6, z: 4, rot: 0 },
    ];
    ops.forEach((op, i) => a.op(`rainop${String(i).padStart(5, "0")}`, op));
    for (let i = 0; i < ops.length; i++) await b.next("applied");

    // dry weather: the bench has nothing to offer
    a.intent({ do: "world", cmd: { cmd: "weather", set: "clear" } });
    await a.next("life", (m) => m.life.world?.weather?.mode === "clear");
    a.intent({ do: "rain", objectId: "benchrainy1", invite: true });
    expect((await a.next("lifeRejected")).reason).toBe("not-raining");

    // rain: Amy sits and asks Ben over; both end up on the two seats, facing the window, in "rain" mode
    a.intent({ do: "world", cmd: { cmd: "weather", set: "rain" } });
    await a.next("life", (m) => m.life.world?.weather?.mode === "rain");
    await new Promise((r) => setTimeout(r, 2500));
    a.intent({ do: "rain", objectId: "benchrainy1", invite: true });
    const both = (l: LifeState) => Object.values(l.avatars).length === 2 && Object.values(l.avatars).every((v) => v.use?.objectId === "benchrainy1" && v.use.action === "rain");
    const seen = await b.next("life", (m) => both(m.life), 12_000);
    const uses = Object.values(seen.life.avatars).map((v) => v.use!);
    expect(new Set(uses.map((u) => u.slot))).toEqual(new Set([0, 1]));
    expect(uses.every((u) => u.pose?.face === 2)).toBe(true);
    expect(uses.some((u) => u.invitedBy)).toBe(true);

    // a refresh lands back in the same seat, in the same rain
    await b.disconnect();
    const again = await b.connect();
    expect(both(again.life)).toBe(true);

    // Ben gets up: the seat is free, Amy is still sitting, and the bonus is over
    const benId = again.memberId;
    b.intent({ do: "stop" });
    const stood = await a.next("life", (m) => Object.values(m.life.avatars).some((v) => !v.use) && Object.values(m.life.avatars).some((v) => v.use?.action === "sit"), 6000);
    expect(stood.life.avatars[benId]?.use ?? null).toBeNull();
    // and he can take it again
    b.intent({ do: "rain", objectId: "benchrainy1", invite: false });
    await a.next("life", (m) => both(m.life), 12_000);
    await a.disconnect();
    await b.disconnect();
  }, 60_000);
});
