import { expect, it } from "vitest";
import { applyOp, catalog, emptyBlueprint, inverseOp, Op, upgradeBlueprint, materialPaintOp, materialRoom, Life, emptyLife, arrivalTime, type Blueprint, type Rot } from "../index";
import data from "../catalog/furniture-expansion.json";
import finishes from "../materials/expansion.json";
import legacy from "../catalog/furniture.json";
import more from "../catalog/furniture-more.json";

function apply(bp: Blueprint, op: Op) {
  const r = applyOp(bp, Op.parse(op)); if (!r.ok) throw Error(r.reason); return r.blueprint;
}
it.each(data)("$id places upstairs in every rotation, round-trips, and undoes without altering downstairs", (item) => {
  let bp = apply(emptyBlueprint(16, 16), { t: "level.add", level: 1 });
  const cells = Array.from({ length: 16 }, (_, x) => Array.from({ length: 16 }, (_, z) => `${x}:${z}`)).flat();
  bp = apply(bp, { t: "floor.paint", level: 1, cells, material: "terrazzo_confetti" });
  for (const rot of [0, 1, 2, 3] as Rot[]) {
    const op: Op = { t: "object.place", level: 1, id: "expanded01", catalogId: item.id, x: 4, z: 4, rot };
    const after = apply(bp, op);
    expect(after.levels[0]).toBe(bp.levels[0]);
    expect(upgradeBlueprint(JSON.parse(JSON.stringify(after)))).toEqual(after);
    expect(apply(after, inverseOp(bp, op)!)).toEqual(bp);
    expect(applyOp(after, { ...op, id: "overlap001" }).ok).toBe(false);
  }
});
it("retains every previous furniture definition and optional saved fields", () => {
  for (const old of [...legacy, ...more]) expect(catalog.furniture.get(old.id)).toMatchObject(old);
  const old = emptyBlueprint(12, 12);
  expect(upgradeBlueprint(JSON.parse(JSON.stringify(old)))).toEqual(old);
});
it.each([...finishes.wallStyles.map((m) => ["wall", m.id] as const), ...finishes.floorMaterials.map((m) => ["floor", m.id] as const)])("applies new %s material %s to one upstairs room, preserving openings and undo", (kind, id) => {
  let bp = apply(emptyBlueprint(10, 10), { t: "level.add", level: 1 });
  bp = apply(bp, { t: "walls.add", level: 1, style: "glass_framed", edges: ["h:2:2", "h:3:2", "h:2:4", "h:3:4", "v:2:2", "v:2:3", "v:4:2", "v:4:3"] });
  bp = apply(bp, { t: "floor.paint", level: 1, cells: ["2:2", "2:3", "3:2", "3:3"], material: "oak" });
  bp = apply(bp, { t: "opening.place", level: 1, id: "newdoor001", catalogId: "door_wood", dir: "h", x: 2, z: 4, flip: false });
  bp = apply(bp, { t: "opening.place", level: 1, id: "newwindow1", catalogId: "window_small", dir: "v", x: 4, z: 2, flip: false });
  const room = materialRoom(bp, 1, 2, 2)!;
  const op = materialPaintOp(bp, 1, kind, kind === "wall" ? room.walls : room.cells, id)!;
  const after = apply(bp, op);
  expect(after.levels[0]).toBe(bp.levels[0]); expect(after.levels[1]!.openings).toEqual(bp.levels[1]!.openings);
  expect(upgradeBlueprint(JSON.parse(JSON.stringify(after)))).toEqual(after);
  expect(apply(after, inverseOp(bp, op)!)).toEqual(bp);
});
it("supports two chefs at the island, serves their salad on its worktop, and finishes hand-washing", () => {
  let bp = apply(emptyBlueprint(14, 14), { t: "object.place", level: 0, id: "island0001", catalogId: "island_butcher", x: 5, z: 5, rot: 0 });
  bp = apply(bp, { t: "object.place", level: 0, id: "vanity0001", catalogId: "double_vanity", x: 8, z: 5, rot: 0 });
  const life = new Life(emptyLife());
  for (const id of ["amy", "ben"]) life.ensureAvatar(id, bp, 0);
  expect(life.cook("amy", bp, "salad", "island0001", 0)).toBeNull();
  expect(life.help("ben", bp, 0)).toBeNull();
  expect(life.state.avatars.amy!.use!.slot).not.toBe(life.state.avatars.ben!.use!.slot);
  let now = 0;
  for (let n = 0; n < 60 && !life.state.dishes.length; n++) {
    life.tick(bp, now); const next = life.nextEvent(now); if (next === null) break; now = Math.max(next, now + 1);
  }
  expect(life.state.cooking).toBeNull();
  expect(life.state.dishes[0]).toMatchObject({ recipeId: "salad", surfaceId: "island0001", portions: 2 });
  expect(life.use("amy", bp, "vanity0001", "wash", now)).toBeNull();
  const end = arrivalTime(life.state.avatars.amy!) + 8_001;
  for (let t = now; t <= end + 250; t += 250) life.tick(bp, t);
  expect(life.state.avatars.amy!.use).toBeNull();
});
