import type { AddressInfo } from "node:net";
import { applyOp, edgesBetween, inverseOp, materialPaintOp, materialRoom, type Blueprint, type HouseSummary, type Op, type ServerMsg } from "@cg/shared";
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app";
import { openSqlite } from "../persistence/node-sqlite";

class Player {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  constructor(base: string, house: string, cookie: string) {
    this.ws = new WebSocket(`${base.replace("http", "ws")}/ws?house=${house}`, { headers: { cookie } });
    this.ws.on("message", (data) => this.inbox.push(JSON.parse(String(data))));
    this.ws.on("open", () => this.ws.send(JSON.stringify({ type: "hello", knownVersion: 0 })));
  }
  async next<T extends ServerMsg["type"]>(type: T, match: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const index = this.inbox.findIndex((m) => m.type === type && match(m as Extract<ServerMsg, { type: T }>));
      if (index >= 0) return this.inbox.splice(index, 1)[0] as Extract<ServerMsg, { type: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error(`Waiting for ${type}: ${JSON.stringify(this.inbox)}`);
  }
  send(id: string, op: Op) { this.ws.send(JSON.stringify({ type: "op", clientOpId: id, op })); }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => { this.ws.once("close", () => resolve()); this.ws.close(); });
  }
}
let app: ReturnType<typeof createApp> | undefined, db: ReturnType<typeof openSqlite> | undefined;
const players: Player[] = [];
afterEach(async () => { await Promise.all(players.splice(0).map((p) => p.close())); await app?.close(); db?.close(); });

it("syncs room materials to a partner, undoes/redoes them, and reloads them after server restart", async () => {
  db = openSqlite(":memory:");
  const start = async () => {
    app = createApp({ directory: db!.directory, houses: db!.houses });
    await new Promise<void>((resolve) => app!.http.listen(0, resolve));
    return `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  };
  let base = await start();
  const call = async (path: string, body: unknown, cookie = "") => {
    const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    expect(response.ok).toBe(true);
    return { body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const aCookie = (await call("/api/account", { name: "Material Amy", password: "material-test-only" })).cookie;
  const bCookie = (await call("/api/account", { name: "Material Ben", password: "material-test-only" })).cookie;
  const house = (await call("/api/houses", { houseName: "Material compatibility" }, aCookie)).body as HouseSummary;
  await call("/api/join", { code: house.inviteCode }, bCookie);
  const a = new Player(base, house.houseId, aCookie), b = new Player(base, house.houseId, bCookie); players.push(a, b);
  const welcome = await a.next("welcome"); await b.next("welcome");
  if (welcome.sync.kind !== "snapshot") throw Error("expected snapshot");
  let bp: Blueprint = welcome.sync.state.blueprint;
  const send = async (id: string, op: Op) => {
    a.send(id, op);
    const applied = await a.next("applied", (m) => m.clientOpId === id), mirrored = await b.next("applied", (m) => m.clientOpId === id);
    expect(mirrored.op).toEqual(applied.op);
    const result = applyOp(bp, op); if (!result.ok) throw Error(result.reason); bp = result.blueprint;
  };
  const edges = [...edgesBetween(1, 1, 4, 1), ...edgesBetween(4, 1, 4, 4), ...edgesBetween(1, 4, 4, 4), ...edgesBetween(1, 1, 1, 4)];
  await send("setup00001", { t: "batch", ops: [
    { t: "level.add", level: 1 }, { t: "walls.add", level: 1, edges, style: "plaster_cream" },
    { t: "floor.paint", level: 1, cells: ["1:1", "2:1", "3:1", "1:2", "2:2", "3:2", "1:3", "2:3", "3:3"], material: "oak" },
    { t: "opening.place", level: 1, id: "matdoor001", catalogId: "door_wood", dir: "h", x: 2, z: 4, flip: false },
    { t: "opening.place", level: 1, id: "matwindow1", catalogId: "window_small", dir: "h", x: 2, z: 1, flip: false },
  ] });
  const before = bp, room = materialRoom(bp, 1, 2, 2)!;
  const wall = materialPaintOp(bp, 1, "wall", room.walls, "glass_framed")!, floor = materialPaintOp(bp, 1, "floor", room.cells, "parquet")!;
  const batch: Op = { t: "batch", ops: [...(wall.t === "batch" ? wall.ops : [wall]), ...(floor.t === "batch" ? floor.ops : [floor])] };
  const undo = inverseOp(bp, batch)!;
  await send("paint00001", batch);
  const painted = bp;
  expect(bp.levels[0]).toEqual(before.levels[0]); expect(bp.levels[1]!.openings).toEqual(before.levels[1]!.openings);
  await send("undo000001", undo); expect(bp).toEqual(before);
  await send("redo000001", batch); expect(bp).toEqual(painted);
  // A partner removes surfaces after the first player has selected them for repainting.
  const lateWall = materialPaintOp(bp, 1, "wall", ["h:1:1"], "brick_red")!;
  const lateFloor = materialPaintOp(bp, 1, "floor", ["1:1"], "marble")!;
  const remove: Op = { t: "batch", ops: [{ t: "walls.remove", level: 1, edges: ["h:1:1"] }, { t: "floor.paint", level: 1, cells: ["1:1"], material: null }] };
  b.send("partner001", remove);
  await a.next("applied", (m) => m.clientOpId === "partner001"); await b.next("applied", (m) => m.clientOpId === "partner001");
  const removed = applyOp(bp, remove); if (!removed.ok) throw Error(removed.reason); bp = removed.blueprint;
  await send("latewall01", lateWall); await send("latefloor1", lateFloor);
  expect(bp.levels[1]!.walls["h:1:1"]).toBeUndefined(); expect(bp.levels[1]!.tiles["1:1"]).toBeUndefined();
  const final = bp;
  await a.close(); await b.close(); await app!.close(); app = undefined;
  base = await start();
  const reconnected = new Player(base, house.houseId, bCookie); players.push(reconnected);
  const loaded = await reconnected.next("welcome");
  expect(loaded.sync.kind).toBe("snapshot");
  if (loaded.sync.kind === "snapshot") expect(loaded.sync.state.blueprint).toEqual(final);
}, 15000);
