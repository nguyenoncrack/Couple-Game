import type { AddressInfo } from "node:net";
import { DEFAULT_APPEARANCE, CLOSE, type ClientMsg, type HouseSummary, type Op, type ServerMsg } from "@cg/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app";
import { hashToken } from "../auth/crypto";
import { openSqlite } from "../persistence/node-sqlite";

/** A scripted player: a signed-in WebSocket plus an inbox we can wait on. */
class Player {
  inbox: ServerMsg[] = [];
  private waiters: (() => void)[] = [];
  ws!: WebSocket;
  closed: number | null = null;

  constructor(
    private url: string,
    readonly houseId: string,
    /** The sign-in cookie ("cg_session=…"). */
    readonly cookie: string,
  ) {}

  connect(knownVersion = 0) {
    this.inbox = [];
    this.closed = null;
    this.ws = new WebSocket(`${this.url}?house=${this.houseId}`, { headers: { cookie: this.cookie } });
    this.ws.on("message", (d) => {
      this.inbox.push(JSON.parse(String(d)));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.ws.on("close", (code) => {
      this.closed = code;
      this.waiters.splice(0).forEach((w) => w());
    });
    this.ws.on("open", () => this.send({ type: "hello", knownVersion }));
    return this.next("welcome");
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  op(clientOpId: string, op: Op) {
    this.send({ type: "op", clientOpId, op });
  }

  /** Wait for (and consume) the first message of this type, optionally matching a predicate. */
  async next<T extends ServerMsg["type"]>(type: T, match: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true): Promise<Extract<ServerMsg, { type: T }>> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && match(m as Extract<ServerMsg, { type: T }>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { type: T }>;
      if (this.closed !== null) throw new Error(`closed (${this.closed}) while waiting for ${type}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}; inbox: ${JSON.stringify(this.inbox)}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 100);
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
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie: set ? set.split(";")[0]! : "" };
}

/** Sign up and return the sign-in cookie. */
async function signUp(name: string, password = "correct horse") {
  const r = await call("POST", "/api/account", { name, password });
  expect(r.status).toBe(201);
  return r.cookie;
}

async function couple() {
  const ana = await signUp("Ana");
  const ben = await signUp("Ben");
  const made = (await call("POST", "/api/houses", { houseName: "Our place" }, ana)).body as unknown as HouseSummary;
  const joined = await call("POST", "/api/join", { code: made.inviteCode.toLowerCase().replace("-", " ") }, ben);
  expect(joined.status).toBe(200);
  const url = `${base.replace("http", "ws")}/ws`;
  return { a: new Player(url, made.houseId, ana), b: new Player(url, made.houseId, ben), houseId: made.houseId };
}

function startApp(roomIdleMs = 60_000, houseIdleMs?: number) {
  app = createApp({ directory: db.directory, houses: db.houses, roomIdleMs, houseIdleMs });
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

describe("accounts", () => {
  it("signs up, in and out, with names unique however they're typed", async () => {
    const cookie = await signUp("Ana Lee");
    expect(cookie).toMatch(/^cg_session=/);
    expect((await call("GET", "/api/me", undefined, cookie)).body).toMatchObject({ account: { name: "Ana Lee" }, houses: [] });
    expect((await call("POST", "/api/account", { name: "  ana   LEE ", password: "something else" })).status).toBe(409);
    expect((await call("POST", "/api/account", { name: "Bo", password: "short" })).status).toBe(400);

    expect((await call("POST", "/api/session", { name: "ana lee", password: "wrong one!" })).status).toBe(401);
    expect((await call("POST", "/api/session", { name: "nobody", password: "correct horse" })).status).toBe(401);
    const again = await call("POST", "/api/session", { name: "ana lee", password: "correct horse" });
    expect(again.status).toBe(200);

    expect((await call("DELETE", "/api/session", undefined, cookie)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, cookie)).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, again.cookie)).status).toBe(200);
  });

  it("signs out everywhere else when the password changes", async () => {
    const first = await signUp("Ana");
    const second = (await call("POST", "/api/session", { name: "Ana", password: "correct horse" })).cookie;
    expect((await call("POST", "/api/account/password", { current: "nope nope", next: "new password" }, first)).status).toBe(401);
    expect((await call("POST", "/api/account/password", { current: "correct horse", next: "new password" }, first)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, first)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, second)).status).toBe(401);
    expect((await call("POST", "/api/session", { name: "Ana", password: "new password" })).status).toBe(200);
  });

  it("takes over a house joined before accounts, given its old device token", async () => {
    const ana = await signUp("Ana");
    const made = (await call("POST", "/api/houses", { houseName: "Old place" }, ana)).body as unknown as HouseSummary;
    // a member from before accounts: no account, just a device token
    db.sql.run(
      "insert into members (id, house_id, account_id, name, color, role, token_hash, joined_at) values (?, ?, null, ?, ?, ?, ?, ?)",
      "oldben00001",
      made.houseId,
      "Ben",
      "#3d8fa3",
      "partner",
      await hashToken("an-old-device-token-from-m3"),
      Date.now(),
    );
    const ben = await signUp("Ben");
    expect((await call("POST", "/api/claims", { claims: [{ houseId: made.houseId, token: "wrong" }] }, ben)).body.houses).toEqual([]);
    const me = await call("POST", "/api/claims", { claims: [{ houseId: made.houseId, token: "an-old-device-token-from-m3" }] }, ben);
    expect(me.body.houses).toMatchObject([{ houseId: made.houseId, memberId: "oldben00001" }]);
  });
});

describe("houses and membership", () => {
  it("lets exactly two people in, and only signed-in members connect", async () => {
    const [ana, ben, cat] = [await signUp("Ana"), await signUp("Ben"), await signUp("Cat")];
    expect((await call("POST", "/api/houses", { houseName: "Home" })).status).toBe(401);
    const made = await call("POST", "/api/houses", { houseName: "Home" }, ana);
    expect(made.status).toBe(201);
    const house = made.body as unknown as HouseSummary;
    expect(house.inviteCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect((await call("POST", "/api/join", { code: "AAA-AAA" }, ben)).status).toBe(404);
    expect((await call("POST", "/api/join", { code: house.inviteCode }, ben)).status).toBe(200);
    // joining again is fine (a second device); a third person isn't
    expect((await call("POST", "/api/join", { code: house.inviteCode }, ben)).status).toBe(200);
    expect((await call("POST", "/api/join", { code: house.inviteCode }, cat)).status).toBe(409);
    expect(((await call("GET", "/api/me", undefined, ben)).body.houses as HouseSummary[]).map((h) => h.houseName)).toEqual(["Home"]);

    const url = `${base.replace("http", "ws")}/ws`;
    await expect(new Player(url, house.houseId, cat).connect()).rejects.toThrow(String(CLOSE.unauthorized));
    await expect(new Player(url, house.houseId, "").connect()).rejects.toThrow(String(CLOSE.unauthorized));
    const welcome = await new Player(url, house.houseId, ben).connect();
    expect(welcome.members.map((m) => m.name)).toEqual(["Ana", "Ben"]);
  });

  it("turns away too many tries as busy, not as someone who isn't a member", async () => {
    const { a, houseId } = await couple();
    const url = `${base.replace("http", "ws")}/ws`;
    // A tab stuck reconnecting uses up the allowance; the next try is "busy", which the game waits out.
    let refused = "";
    for (let i = 0; i < 25 && !refused.includes(String(CLOSE.busy)); i++) refused = await new Player(url, houseId, "").connect().then(() => "", (e: Error) => e.message);
    expect(refused).toContain(String(CLOSE.busy));
    await expect(a.connect()).rejects.toThrow(String(CLOSE.busy));
  });

  it("forgets a house when the last person leaves it", async () => {
    const { houseId } = await couple();
    const [ana, ben] = [(await call("POST", "/api/session", { name: "Ana", password: "correct horse" })).cookie, (await call("POST", "/api/session", { name: "Ben", password: "correct horse" })).cookie];
    expect((await call("DELETE", `/api/houses/${houseId}`, undefined, ana)).status).toBe(200);
    expect(await db.houses.loadSnapshot(houseId)).not.toBeNull();
    expect((await call("DELETE", `/api/houses/${houseId}`, undefined, ben)).status).toBe(200);
    expect(await db.directory.getHouse(houseId)).toBeNull();
    expect(await db.houses.loadSnapshot(houseId)).toBeNull();
  });
});

describe("shared building", () => {
  it("sends each player's edits to the other with increasing versions", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    expect(wa.sync.kind).toBe("snapshot");
    await b.connect();
    expect((await a.next("members", (m) => m.members.every((x) => x.online))).members).toHaveLength(2);

    a.op("opA0000001", { t: "walls.add", level: 0, edges: ["h:0:0", "h:1:0"], style: "plaster_cream" });
    const seenByB = await b.next("applied");
    expect(seenByB).toMatchObject({ version: 1, clientOpId: "opA0000001" });
    expect((await a.next("applied")).version).toBe(1);

    b.op("opB0000001", { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 3, z: 3, rot: 0 });
    expect((await a.next("applied")).version).toBe(2);
    await b.next("applied");
  });

  it("settles simultaneous conflicting edits: one wins, the other is told why", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    // Both try to put something on the same spot at the same moment.
    a.op("opA0000001", { t: "object.place", level: 0, id: "fridge0001", catalogId: "fridge", x: 5, z: 5, rot: 0 });
    b.op("opB0000001", { t: "object.place", level: 0, id: "stove00001", catalogId: "stove", x: 5, z: 5, rot: 0 });
    const winner = await a.next("applied");
    expect(winner.version).toBe(1);
    const loser = winner.clientOpId === "opA0000001" ? b : a;
    expect((await loser.next("rejected")).reason).toBe("overlaps");

    // One player deletes the sofa while the other tries to move it.
    a.op("opA0000002", { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 0, z: 0, rot: 0 });
    await b.next("applied", (m) => m.clientOpId === "opA0000002");
    a.op("opA0000003", { t: "object.remove", level: 0, id: "sofa000001" });
    b.op("opB0000002", { t: "object.move", level: 0, id: "sofa000001", x: 1, z: 1, rot: 0 });
    await b.next("applied", (m) => m.clientOpId === "opA0000003");
    expect((await b.next("rejected")).reason).toBe("not-found");
  });

  it("keeps a held object away from the partner until it's let go", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    a.op("opA0000001", { t: "object.place", level: 0, id: "chair00001", catalogId: "armchair_reading", x: 2, z: 2, rot: 0 });
    await b.next("applied");
    a.send({ type: "hold", objectId: "chair00001" });
    expect((await b.next("holds")).holds).toEqual({ chair00001: expect.any(String) });
    b.op("opB0000001", { t: "object.remove", level: 0, id: "chair00001" });
    expect((await b.next("rejected")).reason).toBe("held");
    // Holder disconnects: the hold is released and the partner can act again.
    await a.disconnect();
    expect((await b.next("holds")).holds).toEqual({});
    b.op("opB0000002", { t: "object.remove", level: 0, id: "chair00001" });
    expect((await b.next("applied")).version).toBe(2);
  });

  it("guards a held door however an edit reaches it: in a batch, or by knocking down its wall", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    a.op("opA0000001", {
      t: "batch",
      ops: [
        { t: "walls.add", level: 0, edges: ["h:2:3", "h:3:3"], style: "plaster_cream" },
        { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 2, z: 3, flip: false },
      ],
    });
    await b.next("applied");
    a.send({ type: "hold", objectId: "door000001" });
    expect((await b.next("holds")).holds).toEqual({ door000001: expect.any(String) });
    b.op("opB0000001", { t: "batch", ops: [{ t: "floor.paint", level: 0, cells: ["0:0"], material: "oak" }, { t: "opening.remove", level: 0, id: "door000001" }] });
    expect((await b.next("rejected")).reason).toBe("held");
    b.op("opB0000002", { t: "walls.remove", level: 0, edges: ["h:2:3"] });
    expect((await b.next("rejected")).reason).toBe("held");
    // once let go, the wall can come down and take the door with it
    a.send({ type: "hold", objectId: null });
    await b.next("holds", (m) => Object.keys(m.holds).length === 0);
    b.op("opB0000003", { t: "walls.remove", level: 0, edges: ["h:2:3"] });
    expect((await b.next("applied")).version).toBe(2);
  });
});

describe("disconnects and saving", () => {
  it("catches a reconnecting player up with only what they missed, and ignores resent ops", async () => {
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    a.op("opA0000001", { t: "floor.paint", level: 0, cells: ["0:0", "0:1"], material: "oak" });
    await b.next("applied");
    await b.disconnect();
    a.op("opA0000002", { t: "floor.paint", level: 0, cells: ["1:0"], material: "oak" });
    a.op("opA0000003", { t: "walls.add", level: 0, edges: ["v:0:0"], style: "brick_red" });
    await a.next("applied", (m) => m.version === 3);

    const welcome = await b.connect(1);
    expect(welcome.sync).toEqual({ kind: "ops", ops: [expect.objectContaining({ version: 2 }), expect.objectContaining({ version: 3 })] });

    // A's tab lost the ack for op 3 and sends it again: nothing is applied twice.
    a.op("opA0000003", { t: "walls.add", level: 0, edges: ["v:0:0"], style: "brick_red" });
    await a.next("duplicate");
  });

  it("brings the house back after the server restarts", async () => {
    const { a, houseId } = await couple();
    await a.connect();
    a.op("opA0000001", { t: "walls.add", level: 0, edges: ["h:2:2", "h:3:2"], style: "plaster_sage" });
    a.op("opA0000002", { t: "object.place", level: 0, id: "bed0000001", catalogId: "bed_double", x: 4, z: 4, rot: 1 });
    await a.next("applied", (m) => m.version === 2);
    await a.disconnect();

    // A crash: a new server process on the same database, with no snapshot written. The op log alone must
    // rebuild the house.
    const crashed = app;
    await startApp();
    const again = new Player(`${base.replace("http", "ws")}/ws`, houseId, a.cookie);
    const welcome = await again.connect();
    expect(welcome.sync.kind).toBe("snapshot");
    if (welcome.sync.kind !== "snapshot") return;
    expect(welcome.sync.state.version).toBe(2);
    expect(Object.keys(welcome.sync.state.blueprint.levels[0]!.walls)).toEqual(["h:2:2", "h:3:2"]);
    expect(welcome.sync.state.blueprint.levels[0]!.objects.bed0000001).toMatchObject({ x: 4, z: 4, rot: 1 });
    await again.disconnect();
    await crashed.close();
  });

  it("runs each player's needs only while they're in, and says so in the welcome", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    expect(wa.life.avatars[wa.memberId]!.needs).toMatchObject({ live: true });
    const wb = await b.connect();
    await b.disconnect();
    await a.next("life", (m) => m.life.avatars[wb.memberId]!.needs?.live === false);
    // back again: their own welcome already has them running
    const again = await b.connect();
    expect(again.life.avatars[wb.memberId]!.needs).toMatchObject({ live: true });
    await a.disconnect();
    await b.disconnect();
  });

  it("lets a second tab of the same player take over from the first", async () => {
    const { a, houseId } = await couple();
    await a.connect();
    const tab2 = new Player(a["url"], houseId, a.cookie);
    await tab2.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(a.closed).toBe(CLOSE.replaced);
    await tab2.disconnect();
  });

  it("lets everyone go after a long quiet spell, but not while someone is busy", async () => {
    await app.close();
    await startApp(60_000, 400);
    const { a, b } = await couple();
    await a.connect();
    await b.connect();
    // moving about keeps the house open past the quiet limit
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 120));
      a.send({ type: "presence", cursor: { x: i, z: 0 }, tool: "select", drag: null });
    }
    expect([a.closed, b.closed]).toEqual([null, null]);
    // pings only say "still connected": they don't count as doing anything
    const pinging = setInterval(() => b.send({ type: "ping" }), 100);
    await new Promise((r) => setTimeout(r, 700));
    clearInterval(pinging);
    expect([a.closed, b.closed]).toEqual([CLOSE.idle, CLOSE.idle]);
    // coming back in works as usual
    await a.connect();
    await a.disconnect();
  });
});

describe("living together", () => {
  it("gives each player a character who can walk and sit, one to a seat", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    expect(Object.keys(wa.life.avatars)).toEqual([wa.memberId]);
    const wb = await b.connect();
    expect(Object.keys(wb.life.avatars).sort()).toEqual([wa.memberId, wb.memberId].sort());

    a.op("opA0000001", { t: "object.place", level: 0, id: "chair00001", catalogId: "dining_chair", x: 5, z: 5, rot: 0 });
    await b.next("applied");
    a.send({ type: "life", intent: { do: "use", objectId: "chair00001", action: "sit" } });
    await b.next("life", (m) => m.life.avatars[wa.memberId]?.use?.objectId === "chair00001");
    b.send({ type: "life", intent: { do: "use", objectId: "chair00001", action: "sit" } });
    expect((await b.next("lifeRejected")).reason).toBe("taken");

    b.send({ type: "life", intent: { do: "walk", x: 2, z: 2 } });
    const seen = await a.next("life", (m) => m.life.avatars[wb.memberId]!.path.at(-1)![0] === 2.5);
    expect(seen.life.avatars[wb.memberId]!.path.at(-1)).toEqual([2.5, 2.5]);

    // the chair goes: whoever was on it is back on their feet
    b.op("opB0000001", { t: "object.remove", level: 0, id: "chair00001" });
    await a.next("life", (m) => m.life.avatars[wa.memberId]!.use === null);
    await a.disconnect();
    await b.disconnect();
  });

  it("talks, keeps the last things said, and hugs", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    const wb = await b.connect();
    expect(wa.chat).toEqual([]);
    a.send({ type: "chat", text: "  hi love \u0007 " });
    const heard = await b.next("chat");
    expect(heard.message).toMatchObject({ by: wa.memberId, text: "hi love" });
    expect((await a.next("chat")).message.id).toBe(heard.message.id);
    a.send({ type: "chat", text: "   " });
    b.send({ type: "chat", text: "x".repeat(400) });
    expect((await a.next("chat")).message.text).toHaveLength(240);
    // flooding is slowed down
    for (let i = 0; i < 10; i++) b.send({ type: "chat", text: `spam ${i}` });
    expect((await b.next("error")).code).toBe("rate-limited");

    b.send({ type: "life", intent: { do: "social", action: "hug" } });
    const hug = await a.next("life", (m) => m.life.avatars[wa.memberId]?.use?.action === "hug");
    expect(hug.life.avatars[wb.memberId]!.use).toMatchObject({ action: "hug", with: wa.memberId });
    b.send({ type: "life", intent: { do: "social", action: "cuddle" } });
    expect((await b.next("lifeRejected")).reason).toBe("not-in-bed");
    await a.disconnect();
    await b.next("members", (m) => !m.members.find((x) => x.id === wa.memberId)!.online);
    b.send({ type: "life", intent: { do: "social", action: "kiss" } });
    expect((await b.next("lifeRejected")).reason).toBe("partner-away");
    await b.disconnect();

    // coming back, the chat is still there, oldest first
    const again = await a.connect();
    expect(again.chat.map((m) => m.text).slice(0, 2)).toEqual(["hi love", "x".repeat(240)]);
    await a.disconnect();
  });

  it("shares blackjack hands and results, rejects stale deals, and restores the table on reconnect", async () => {
    const { a, b } = await couple();
    const wa = await a.connect(); const wb = await b.connect();
    a.op("cards00001", { t: "object.place", level: 0, id: "table00001", catalogId: "blackjack_table", x: 12, z: 18, rot: 0 });
    await a.next("applied");
    a.send({ type: "life", intent: { do: "use", objectId: "table00001", action: "blackjack" } });
    b.send({ type: "life", intent: { do: "use", objectId: "table00001", action: "blackjack" } });
    await a.next("life", (m) => m.life.avatars[wa.memberId]?.use?.action === "blackjack" && m.life.avatars[wb.memberId]?.use?.action === "blackjack");
    a.send({ type: "life", intent: { do: "cards", objectId: "table00001", roundId: null, action: "deal" } });
    const dealt = await a.next("life", (m) => Boolean(m.life.blackjack?.table00001));
    const mirrored = await b.next("life", (m) => Boolean(m.life.blackjack?.table00001));
    expect(mirrored.life.blackjack).toEqual(dealt.life.blackjack);
    const round = dealt.life.blackjack!.table00001!;
    expect(Object.keys(round.hands).sort()).toEqual([wa.memberId, wb.memberId].sort());
    a.send({ type: "life", intent: { do: "cards", objectId: "table00001", roundId: null, action: "deal" } });
    expect((await a.next("lifeRejected")).reason).toBe("round-changed");
    for (const [player, id] of [[a, wa.memberId], [b, wb.memberId]] as const) if (round.hands[id]!.status === "playing")
      player.send({ type: "life", intent: { do: "cards", objectId: "table00001", roundId: round.id, action: "stand" } });
    const finished = await a.next("life", (m) => m.life.blackjack?.table00001?.phase === "finished");
    expect(Object.values(finished.life.blackjack!.table00001!.hands).every((h) => h.result)).toBe(true);
    await a.disconnect();
    const welcome = await a.connect();
    expect(welcome.life.blackjack).toEqual(finished.life.blackjack);
    await a.disconnect(); await b.disconnect();
  });

  it("syncs two PS5 players on separate seats and keeps gaming across a reconnect", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    const wb = await b.connect();
    a.op("gaming0001", { t: "batch", ops: [
      { t: "object.place", level: 0, id: "console001", catalogId: "ps5_setup", x: 14, z: 15, rot: 0 },
      { t: "object.place", level: 0, id: "tv00000001", catalogId: "tv_stand", x: 11, z: 15, rot: 0 },
      { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 11, z: 18, rot: 2 },
    ] });
    await a.next("applied");
    a.send({ type: "life", intent: { do: "use", objectId: "console001", action: "play" } });
    b.send({ type: "life", intent: { do: "use", objectId: "console001", action: "play" } });
    const bothPlaying = (m: Extract<ServerMsg, { type: "life" }>) => m.life.avatars[wa.memberId]?.use?.action === "play" && m.life.avatars[wb.memberId]?.use?.action === "play";
    const first = await a.next("life", bothPlaying);
    const second = await b.next("life", bothPlaying);
    expect(first.life).toEqual(second.life);
    const ana = first.life.avatars[wa.memberId]!.use!;
    const ben = first.life.avatars[wb.memberId]!.use!;
    expect(ana).toMatchObject({ objectId: "sofa000001", consoleId: "console001", tv: "tv00000001" });
    expect(ana.slot).not.toBe(ben.slot);
    await a.disconnect();
    const again = await a.connect();
    expect(again.life.avatars[wa.memberId]!.use).toEqual(ana);
    a.send({ type: "life", intent: { do: "stop" } });
    const stopped = await b.next("life", (m) => m.life.avatars[wa.memberId]?.use === null);
    expect(stopped.life.avatars[wb.memberId]!.use).toEqual(ben);
    await a.disconnect();
    await b.disconnect();
  });

  it("cooks only while the cook is here", async () => {
    const { a, b } = await couple();
    const wa = await a.connect();
    await b.connect();
    a.op("opA0000001", {
      t: "batch",
      ops: [
        { t: "object.place", level: 0, id: "counter001", catalogId: "counter", x: 12, z: 17, rot: 0 },
        { t: "object.place", level: 0, id: "stove00001", catalogId: "stove", x: 13, z: 17, rot: 0 },
      ],
    });
    await a.next("applied");
    a.send({ type: "life", intent: { do: "cook", recipeId: "pancakes", objectId: "counter001" } });
    await b.next("life", (m) => (m.life.cooking?.rate ?? 0) > 0);
    await a.disconnect();
    const paused = await b.next("life", (m) => m.life.cooking?.rate === 0);
    expect(paused.life.cooking).toMatchObject({ recipeId: "pancakes", step: 0, startedBy: wa.memberId });
    await b.disconnect();
  });

  it("remembers where everyone was after a restart", async () => {
    const { a, houseId } = await couple();
    const wa = await a.connect();
    a.op("opA0000001", { t: "object.place", level: 0, id: "chair00001", catalogId: "dining_chair", x: 5, z: 5, rot: 0 });
    await a.next("applied");
    a.send({ type: "life", intent: { do: "use", objectId: "chair00001", action: "sit" } });
    await a.next("life", (m) => m.life.avatars[wa.memberId]?.use?.objectId === "chair00001");
    await a.disconnect();
    await new Promise((r) => setTimeout(r, 50));

    const old = app;
    await startApp();
    const again = new Player(`${base.replace("http", "ws")}/ws`, houseId, a.cookie);
    const welcome = await again.connect();
    expect(welcome.life.avatars[wa.memberId]).toMatchObject({ use: { objectId: "chair00001", action: "sit" } });
    await again.disconnect();
    await old.close();
  });
});


describe("character appearance", () => {
  it("saves to the signed-in account, broadcasts to the partner, and survives reconnect without editing the house", async () => {
    const { a, b, houseId } = await couple();
    const first = await a.connect();
    await b.connect();
    await a.next("members");
    await a.next("life"); // the partner arrived; not an appearance change
    a.send({ type: "life", intent: { do: "walk", x: 5, z: 5 } });
    const walking = await a.next("life");
    await b.next("life");
    a.inbox = []; b.inbox = [];
    const look = { ...DEFAULT_APPEARANCE, gender: "girl", hairstyle: "braid", skinTone: "umber", outfit: "skirt" };
    const saved = await call("PUT", "/api/account/appearance", look, a.cookie);
    expect(saved.status).toBe(200);
    expect((await call("GET", "/api/account/appearance", undefined, a.cookie)).body).toEqual({ appearance: look });
    const update = await b.next("members", (m) => m.members.some((x) => x.id === first.memberId && x.appearance?.hairstyle === "braid"));
    expect(update.members.find((x) => x.id === first.memberId)?.appearance).toEqual(look);
    expect((await call("GET", "/api/me", undefined, a.cookie)).body).toMatchObject({ account: { appearance: look } });
    expect((await call("GET", "/api/me", undefined, b.cookie)).body).toMatchObject({ account: { appearance: null } });
    expect(a.inbox.some((m) => m.type === "applied" || m.type === "life")).toBe(false);
    expect(b.inbox.some((m) => m.type === "applied" || m.type === "life")).toBe(false);
    await a.disconnect();
    const rejoined = await a.connect();
    expect(rejoined.members.find((x) => x.id === first.memberId)?.appearance).toEqual(look);
    expect(rejoined.sync).toEqual(first.sync);
    expect(rejoined.life.avatars[first.memberId]?.path).toEqual(walking.life.avatars[first.memberId]?.path);
    expect(rejoined.life.avatars[first.memberId]?.startedAt).toBe(walking.life.avatars[first.memberId]?.startedAt);
    expect((await db.directory.listMembers(houseId)).find((x) => x.id === first.memberId)?.appearance).toEqual(look);
    await a.disconnect(); await b.disconnect();
  });

  it("requires sign-in and rejects invalid or gameplay-bearing payloads", async () => {
    expect((await call("PUT", "/api/account/appearance", DEFAULT_APPEARANCE)).status).toBe(401);
    const cookie = await signUp("Wardrobe test");
    for (const invalid of [{ ...DEFAULT_APPEARANCE, outfit: "flight" }, { ...DEFAULT_APPEARANCE, speed: 100 }, { ...DEFAULT_APPEARANCE, accountId: "another-account" }]) {
      expect((await call("PUT", "/api/account/appearance", invalid, cookie)).status).toBe(400);
    }
    expect((await call("GET", "/api/me", undefined, cookie)).body).toMatchObject({ account: { appearance: null } });
  });

  it("keeps independent looks for two accounts, including concurrent saves", async () => {
    const { a, b } = await couple();
    const girl = { ...DEFAULT_APPEARANCE, gender: "girl", hairstyle: "waves", outfit: "shorts" };
    const [one, two] = await Promise.all([call("PUT", "/api/account/appearance", DEFAULT_APPEARANCE, a.cookie), call("PUT", "/api/account/appearance", girl, b.cookie)]);
    expect(one.status).toBe(200); expect(two.status).toBe(200);
    expect((await call("GET", "/api/me", undefined, a.cookie)).body).toMatchObject({ account: { appearance: DEFAULT_APPEARANCE } });
    expect((await call("GET", "/api/me", undefined, b.cookie)).body).toMatchObject({ account: { appearance: girl } });
  });
});
