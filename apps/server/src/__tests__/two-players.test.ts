import type { AddressInfo } from "node:net";
import { CLOSE, type ClientMsg, type Op, type ServerMsg } from "@cg/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app";
import { SqliteStore } from "../persistence/sqlite-store";

/** A scripted player: a WebSocket plus an inbox we can wait on. */
class Player {
  inbox: ServerMsg[] = [];
  private waiters: (() => void)[] = [];
  ws!: WebSocket;
  closed: number | null = null;

  constructor(
    private url: string,
    readonly houseId: string,
    readonly token: string,
  ) {}

  connect(knownVersion = 0) {
    this.inbox = [];
    this.closed = null;
    this.ws = new WebSocket(this.url);
    this.ws.on("message", (d) => {
      this.inbox.push(JSON.parse(String(d)));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.ws.on("close", (code) => {
      this.closed = code;
      this.waiters.splice(0).forEach((w) => w());
    });
    this.ws.on("open", () => this.send({ type: "hello", houseId: this.houseId, token: this.token, knownVersion }));
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

let store: SqliteStore;
let app: ReturnType<typeof createApp>;
let base: string;

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

async function couple() {
  const made = await post("/api/houses", { houseName: "Our place", playerName: "Ana" });
  const joined = await post("/api/join", { code: made.body.inviteCode!.toLowerCase().replace("-", " "), playerName: "Ben" });
  expect(joined.status).toBe(200);
  const url = `${base.replace("http", "ws")}/ws`;
  return { a: new Player(url, made.body.houseId!, made.body.token!), b: new Player(url, joined.body.houseId!, joined.body.token!), houseId: made.body.houseId! };
}

function startApp(roomIdleMs = 60_000) {
  app = createApp({ store, roomIdleMs });
  return new Promise<void>((r) =>
    app.http.listen(0, () => {
      base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
      r();
    }),
  );
}

beforeEach(async () => {
  store = new SqliteStore(":memory:");
  await startApp();
});

afterEach(async () => {
  await app.close();
  store.close();
});

describe("houses and membership", () => {
  it("lets exactly two people in, and only with the right code and token", async () => {
    const made = await post("/api/houses", { houseName: "Home", playerName: "Ana" });
    expect(made.status).toBe(201);
    expect(made.body.inviteCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect((await post("/api/join", { code: "AAA-AAA", playerName: "Eve" })).status).toBe(404);
    expect((await post("/api/join", { code: made.body.inviteCode, playerName: "Ben" })).status).toBe(200);
    expect((await post("/api/join", { code: made.body.inviteCode, playerName: "Cat" })).status).toBe(409);

    const stranger = new Player(`${base.replace("http", "ws")}/ws`, made.body.houseId!, "x".repeat(43));
    await expect(stranger.connect()).rejects.toThrow(String(CLOSE.unauthorized));
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
    const again = new Player(`${base.replace("http", "ws")}/ws`, houseId, a.token);
    const welcome = await again.connect();
    expect(welcome.sync.kind).toBe("snapshot");
    if (welcome.sync.kind !== "snapshot") return;
    expect(welcome.sync.state.version).toBe(2);
    expect(Object.keys(welcome.sync.state.blueprint.levels[0]!.walls)).toEqual(["h:2:2", "h:3:2"]);
    expect(welcome.sync.state.blueprint.levels[0]!.objects.bed0000001).toMatchObject({ x: 4, z: 4, rot: 1 });
    await again.disconnect();
    await crashed.close();
  });

  it("lets a second tab of the same player take over from the first", async () => {
    const { a, houseId } = await couple();
    await a.connect();
    const tab2 = new Player(a["url"], houseId, a.token);
    await tab2.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(a.closed).toBe(CLOSE.replaced);
    await tab2.disconnect();
  });
});
