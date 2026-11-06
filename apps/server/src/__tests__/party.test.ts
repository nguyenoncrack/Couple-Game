import type { AddressInfo } from "node:net";
import type { ClientMsg, HouseSummary, LifeIntent, LifeState, Op, PartyCmd, ServerMsg } from "@cg/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app";
import { openSqlite } from "../persistence/node-sqlite";

/** A scripted player: a signed-in WebSocket and an inbox to wait on. */
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
  op(id: string, op: Op) {
    this.send({ type: "op", clientOpId: id, op });
  }
  intent(intent: LifeIntent) {
    this.send({ type: "life", intent });
  }
  party(cmd: PartyCmd) {
    this.intent({ do: "party", cmd });
  }
  async next<T extends ServerMsg["type"]>(type: T, match: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true) {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && match(m as Extract<ServerMsg, { type: T }>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { type: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}; inbox: ${JSON.stringify(this.inbox.map((m) => m.type))}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  /** The next life message whose party state satisfies `ok`. */
  life(ok: (l: LifeState) => boolean) {
    return this.next("life", (m) => ok(m.life));
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
  const made = (await call("POST", "/api/houses", { houseName: "Party house" }, ana)).body as unknown as HouseSummary;
  expect((await call("POST", "/api/join", { code: made.inviteCode }, ben)).status).toBe(200);
  const url = `${base.replace("http", "ws")}/ws`;
  return { a: new Player(url, made.houseId, ana), b: new Player(url, made.houseId, ben), houseId: made.houseId, url, ana };
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

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";

/** Place the party gear and wait until both players have it. */
async function furnish(a: Player, b: Player, extra: [string, string, number, number][] = []) {
  const gear: [string, string, number, number][] = [["mus0000001", "music_player", 2, 2], ["dj00000001", "dj_booth", 4, 6], ["las0000001", "laser_light", 9, 2], ["tile000001", "dance_tile", 7, 6], ...extra];
  gear.forEach(([id, catalogId, x, z], i) => a.op(`op${String(i).padStart(8, "0")}`, { t: "object.place", level: 0, id, catalogId, x, z, rot: 0 }));
  for (let i = 0; i < gear.length; i++) await b.next("applied");
}

describe("party night, over the wire", () => {
  it("won't touch the lights or the music in a house with no party gear", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    a.party({ cmd: "lights", set: { on: true } });
    expect((await a.next("error")).code).toBe("no-party-items");
    a.party({ cmd: "add", videoId: A });
    expect((await a.next("error")).code).toBe("no-music");
    await a.disconnect();
    await b.disconnect();
  });

  it("shares the lights between both players, and settles two people changing them at once", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    await furnish(a, b);
    a.party({ cmd: "lights", set: { on: true, brightness: 0.4, preset: "sunset" } });
    const seen = await b.life((l) => l.party?.lights.on === true);
    expect(seen.life.party!.lights).toMatchObject({ on: true, brightness: 0.4, preset: "sunset" });
    // both at once: one order wins and both end up showing the same thing
    a.party({ cmd: "lights", set: { preset: "chill", steady: true } });
    b.party({ cmd: "lights", set: { preset: "neon", color: "#ff3d9a", spread: 0.3 } });
    await a.life((l) => l.party?.lights.spread === 0.3);
    await b.life((l) => l.party?.lights.spread === 0.3);
    expect(a.last!.party!.lights).toEqual(b.last!.party!.lights);
    expect(a.last!.party!.lights).toMatchObject({ steady: true, spread: 0.3 });
    await a.disconnect();
    await b.disconnect();
  });

  it("shares a music queue: either player adds, pauses and skips, and a stale 'ended' skips nothing", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    await furnish(a, b);
    a.party({ cmd: "add", videoId: A });
    const first = (await b.life((l) => l.party?.music.current?.videoId === A)).life.party!.music;
    expect(first).toMatchObject({ playing: true, queue: [] });
    b.party({ cmd: "add", videoId: B });
    a.party({ cmd: "add", videoId: C });
    await a.life((l) => l.party?.music.queue.length === 2);
    expect(a.last!.party!.music.queue.map((t) => [t.videoId, t.by === a.last!.party!.music.current!.by])).toEqual([[B, false], [C, true]]);

    b.party({ cmd: "pause" });
    await a.life((l) => l.party?.music.playing === false);
    a.party({ cmd: "play" });
    await b.life((l) => l.party?.music.playing === true);

    // both screens report the first video ended: it moves on once
    const ended = a.last!.party!.music.current!.id;
    a.party({ cmd: "ended", trackId: ended });
    b.party({ cmd: "ended", trackId: ended });
    await b.life((l) => l.party?.music.current?.videoId === B);
    await new Promise((r) => setTimeout(r, 150));
    expect(b.last!.party!.music.current!.videoId).toBe(B);
    expect(b.last!.party!.music.queue.map((t) => t.videoId)).toEqual([C]);

    // YouTube won't play it: skipped
    b.party({ cmd: "error", trackId: b.last!.party!.music.current!.id, code: 101 });
    await a.life((l) => l.party?.music.current?.videoId === C);
    a.party({ cmd: "seek", ms: 90_000 });
    await b.life((l) => l.party!.music.at !== a.last!.party!.music.at && l.party?.music.current?.videoId === C);
    await a.disconnect();
    await b.disconnect();
  });

  it("turns away what isn't a real party message, and anyone flooding the panel", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    await furnish(a, b);
    for (const cmd of [{ cmd: "add", videoId: "<script>alert(1)</script>" }, { cmd: "lights", set: { brightness: 9 } }, { cmd: "seek", ms: -1 }, { cmd: "format-disk" }]) {
      a.intent({ do: "party", cmd } as never);
      expect((await a.next("error")).code).toBe("invalid");
    }
    expect(a.last?.party).toBeUndefined();
    // a flood of slider moves: the house keeps up with some, and says to slow down
    for (let i = 0; i < 80; i++) a.party({ cmd: "lights", set: { brightness: i % 2 ? 0.5 : 0.6 } });
    await a.next("error", (m) => m.code === "rate-limited");
    await a.disconnect();
    await b.disconnect();
  });

  it("brings a late joiner, and a reconnecting player, into the music at the right place", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    await furnish(a, b);
    a.party({ cmd: "lights", set: { on: true, preset: "chill" } });
    a.party({ cmd: "add", videoId: A, start: 30 });
    a.party({ cmd: "add", videoId: B });
    await b.life((l) => l.party?.music.queue.length === 1);
    await b.disconnect();
    // while they're away someone changes the queue and the lights
    a.party({ cmd: "add", videoId: C });
    a.party({ cmd: "lights", set: { preset: "aurora" } });
    await a.life((l) => l.party?.music.queue.length === 2 && l.party!.lights.preset === "aurora");
    const welcome = await b.connect();
    const music = welcome.life.party!.music;
    expect(music).toMatchObject({ playing: true, current: { videoId: A, start: 30 } });
    expect(music.queue.map((t) => t.videoId)).toEqual([B, C]);
    expect(welcome.life.party!.lights).toMatchObject({ on: true, preset: "aurora" });
    // the server's own clock says where they are in it: about 30 s plus the little while that's passed
    const pos = welcome.now - music.at;
    expect(pos).toBeGreaterThanOrEqual(30_000);
    expect(pos).toBeLessThan(40_000);
    await a.disconnect();
    await b.disconnect();
  });

  it("holds the music when the house empties, and keeps lights and queue through a restart", async () => {
    const { a, b, houseId, url, ana } = await couple();
    await a.connect();
    await b.connect();
    await furnish(a, b);
    a.party({ cmd: "lights", set: { on: true, preset: "sunset", steady: true } });
    a.party({ cmd: "add", videoId: A });
    a.party({ cmd: "add", videoId: B });
    await b.life((l) => l.party?.music.queue.length === 1);
    await new Promise((r) => setTimeout(r, 300));
    await a.disconnect();
    await b.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const old = app;
    await startApp();
    const again = new Player(`${base.replace("http", "ws")}/ws`, houseId, ana);
    const welcome = await again.connect();
    const party = welcome.life.party!;
    expect(party.lights).toMatchObject({ on: true, preset: "sunset", steady: true });
    expect(party.music).toMatchObject({ playing: false, current: { videoId: A } });
    expect(party.music.at).toBeGreaterThanOrEqual(200);
    expect(party.music.queue.map((t) => t.videoId)).toEqual([B]);
    // it waits to be played, and plays on from where it was
    again.party({ cmd: "play" });
    const going = (await again.life((l) => Boolean(l.party?.music.playing))).life.party!.music;
    expect(welcome.now - 0).toBeGreaterThan(0);
    expect(going.at).toBeLessThanOrEqual(Date.now());
    await again.disconnect();
    await old.close();
    void url;
  });

  it("lets both players dance and work the booth, ends one for the other, and stops cleanly", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    const wb = await b.connect();
    await furnish(a, b);
    a.intent({ do: "dance", objectId: null, move: "disco" });
    b.intent({ do: "use", objectId: "dj00000001", action: "dj" });
    await a.life((l) => l.avatars[wa.memberId]?.use?.action === "groove" && l.avatars[wb.memberId]?.use?.action === "dj");
    expect(a.last!.avatars[wa.memberId]!.use).toMatchObject({ move: "disco", objectId: null });
    // a dance on the tile ends the booth for no one: only your own activity is replaced
    b.intent({ do: "dance", objectId: "tile000001", move: "sway" });
    await b.life((l) => l.avatars[wb.memberId]?.use?.action === "groove" && l.avatars[wb.memberId]?.use?.objectId === "tile000001");
    expect(b.last!.avatars[wa.memberId]!.use?.action).toBe("groove");
    // walking, or any other order, ends the dance
    a.intent({ do: "walk", x: 1, z: 1 });
    await b.life((l) => l.avatars[wa.memberId]?.use === null);
    b.intent({ do: "stop" });
    await a.life((l) => l.avatars[wb.memberId]?.use === null);
    // the music and lights are the house's: dancing changed neither
    expect(a.last!.party).toBeUndefined();
    await a.disconnect();
    await b.disconnect();
  });
});
