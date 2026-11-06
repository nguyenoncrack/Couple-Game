import type { AddressInfo } from "node:net";
import { applyOp, inverseOp, type Blueprint, type HouseSummary, type Op, type ServerMsg } from "@cg/shared";
import { afterEach, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app";
import { openSqlite } from "../persistence/node-sqlite";
import items from "../../../../packages/shared/src/catalog/furniture-expansion.json";
import finishes from "../../../../packages/shared/src/materials/expansion.json";

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

it("synchronizes all expansion IDs, shared seating, undo and persisted materials across restart", async () => {
  db = openSqlite(":memory:");
  const start = async () => {
    app = createApp({ directory: db!.directory, houses: db!.houses });
    await new Promise<void>((resolve, reject) => { app!.http.once("error", reject); app!.http.listen(0, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  };
  let base = await start();
  const call = async (path: string, body: unknown, cookie = "") => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    expect(r.ok).toBe(true); return { body: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const ac = (await call("/api/account", { name: "Expansion Amy", password: "expansion-test-only" })).cookie;
  const bc = (await call("/api/account", { name: "Expansion Ben", password: "expansion-test-only" })).cookie;
  const house = (await call("/api/houses", { houseName: "Expansion", starter: false }, ac)).body as HouseSummary;
  await call("/api/join", { code: house.inviteCode }, bc);
  const a = new Player(base, house.houseId, ac), b = new Player(base, house.houseId, bc); players.push(a, b);
  const wa = await a.next("welcome"), wb = await b.next("welcome");
  if (wa.sync.kind !== "snapshot") throw Error("expected snapshot");
  let bp: Blueprint = wa.sync.state.blueprint;
  const send = async (id: string, op: Op) => {
    a.send(id, op);
    const first = await a.next("applied", m => m.clientOpId === id), second = await b.next("applied", m => m.clientOpId === id);
    expect(first.op).toEqual(second.op);
    const r = applyOp(bp, op); if (!r.ok) throw Error(r.reason); bp = r.blueprint;
  };
  const placements: Op = { t: "batch", ops: items.map((item, i) => ({ t: "object.place", level: 0, id: `expansion${String(i).padStart(2,"0")}`, catalogId: item.id, x: 1 + i % 6 * 3, z: 1 + Math.floor(i / 6) * 5, rot: 0 })) };
  const undo = inverseOp(bp, placements)!;
  await send("placeall01", placements);
  expect(Object.values(bp.levels[0]!.objects).filter(o => items.some(i => i.id === o.catalogId))).toHaveLength(18);
  await send("undoall001", undo); expect(Object.keys(bp.levels[0]!.objects)).toHaveLength(0);
  await send("redoall001", placements);
  // Both players can reserve the bench's distinct seats using the existing life protocol.
  const bench = `expansion${String(items.findIndex(i => i.id === "bedroom_bench")).padStart(2,"0")}`;
  for (const player of [a,b]) player.ws.send(JSON.stringify({ type: "life", intent: { do: "use", objectId: bench, action: "sit" } }));
  const together = (m: Extract<ServerMsg,{type:"life"}>) => m.life.avatars[wa.memberId]?.use?.objectId === bench && m.life.avatars[wb.memberId]?.use?.objectId === bench;
  const seated = await a.next("life", together); await b.next("life", together);
  expect(seated.life.avatars[wa.memberId]!.use!.slot).not.toBe(seated.life.avatars[wb.memberId]!.use!.slot);
  const sink = `expansion${String(items.findIndex(i => i.id === "double_vanity")).padStart(2,"0")}`;
  for (const player of [a,b]) player.ws.send(JSON.stringify({ type: "life", intent: { do: "use", objectId: sink, action: "wash" } }));
  const washing = (m: Extract<ServerMsg,{type:"life"}>) => m.life.avatars[wa.memberId]?.use?.objectId === sink && m.life.avatars[wb.memberId]?.use?.objectId === sink;
  const washed = await a.next("life", washing); await b.next("life", washing);
  expect(washed.life.avatars[wa.memberId]!.use!.slot).not.toBe(washed.life.avatars[wb.memberId]!.use!.slot);
  await send("addfloor01", { t: "level.add", level: 1 });
  for (const [i, m] of finishes.wallStyles.entries()) await send(`wallstyle${i}`, { t: "walls.add", level: 1, edges: [`h:${2+i}:2`], style: m.id });
  for (const [i, m] of finishes.floorMaterials.entries()) await send(`floorstyle${i}`, { t: "floor.paint", level: 1, cells: [`${2+i}:2`], material: m.id });
  const final = bp;
  await a.close(); await b.close(); await app!.close(); app = undefined;
  base = await start();
  const reconnected = new Player(base, house.houseId, ac); players.push(reconnected);
  const loaded = await reconnected.next("welcome");
  if (loaded.sync.kind !== "snapshot") throw Error("expected snapshot");
  expect(loaded.sync.state.blueprint).toEqual(final);
}, 15000);
