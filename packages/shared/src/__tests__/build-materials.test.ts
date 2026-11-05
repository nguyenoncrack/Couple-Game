import { describe, expect, it } from "vitest";
import { applyOp, buildNav, catalog, cellKey, edgeKey, emptyBlueprint, inverseOp, liftShafts, materialPaintOp, materialRoom, Op, stairHoles, undoCheck, upgradeBlueprint, type Blueprint } from "../index";

function apply(bp: Blueprint, op: Op) {
  const result = applyOp(bp, Op.parse(op));
  if (!result.ok) throw Error(result.reason);
  return result.blueprint;
}
function rooms() {
  let bp = apply(emptyBlueprint(10, 8), { t: "level.add", level: 1 });
  const edges = [...Array.from({ length: 6 }, (_, i) => [edgeKey("h", i + 1, 1), edgeKey("h", i + 1, 5)]).flat(), ...[1, 4, 7].flatMap((x) => Array.from({ length: 4 }, (_, i) => edgeKey("v", x, i + 1)))];
  bp = apply(bp, { t: "walls.add", level: 1, edges, style: "plaster_cream" });
  bp = apply(bp, { t: "floor.paint", level: 1, cells: Array.from({ length: 6 }, (_, x) => Array.from({ length: 4 }, (_, z) => cellKey(x + 1, z + 1))).flat(), material: "oak" });
  bp = apply(bp, { t: "opening.place", level: 1, id: "door000001", catalogId: "door_wood", dir: "v", x: 4, z: 2, flip: false });
  bp = apply(bp, { t: "opening.place", level: 1, id: "window0001", catalogId: "window_small", dir: "h", x: 2, z: 1, flip: true });
  return bp;
}

it("offers every requested family while retaining old saved IDs", () => {
  expect(new Set([...catalog.wallStyles.values()].map((v) => v.surface))).toEqual(new Set(["plaster", "panels", "brick", "stone", "tile", "concrete", "glass"]));
  for (const surface of ["oak", "walnut", "parquet", "tile", "marble", "carpet", "concrete", "decking"]) expect([...catalog.floorMaterials.values()].some((v) => v.surface === surface)).toBe(true);
  for (const id of ["oak", "walnut", "tile_white", "tile_blue", "carpet_sand", "stone", "concrete"]) expect(catalog.floorMaterials.has(id)).toBe(true);
  for (const id of ["plaster_cream", "plaster_sage", "plaster_blush", "plaster_sky", "brick_red", "wood_panel"]) expect(catalog.wallStyles.has(id)).toBe(true);
});

it("finds the selected room on the selected floor without crossing a door or window", () => {
  const bp = rooms(), left = materialRoom(bp, 1, 2, 2)!;
  expect(left.cells).toHaveLength(12);
  expect(left.cells.every((c) => Number(c.split(":")[0]) < 4)).toBe(true);
  expect(left.walls).toContain("v:4:2");
  expect(materialRoom(bp, 1, 5, 2)!.cells).toHaveLength(12);
  expect(materialRoom(bp, 0, 2, 2)).toBeNull();
  expect(materialRoom(bp, 1, 0, 0)).toBeNull();
  expect(materialRoom(bp, 4, 2, 2)).toBeNull();
});

it("repaints room walls without removing openings, changing geometry or touching other levels", () => {
  const bp = rooms(), room = materialRoom(bp, 1, 2, 2)!, op = materialPaintOp(bp, 1, "wall", room.walls, "glass_framed")!;
  const after = apply(bp, op);
  expect(after.levels[1]!.openings).toEqual(bp.levels[1]!.openings);
  expect(Object.keys(after.levels[1]!.walls)).toEqual(Object.keys(bp.levels[1]!.walls));
  expect(after.levels[0]).toBe(bp.levels[0]);
  expect(after.funds).toBe(bp.funds);
  expect(buildNav(after, 1).blocked).toEqual(buildNav(bp, 1).blocked);
  expect(after.levels[1]!.walls["h:5:1"]!.style).toBe("plaster_cream");
  const undo = inverseOp(bp, op)!;
  expect(apply(after, undo)).toEqual(bp);
  expect(apply(apply(after, undo), op)).toEqual(after);
});

it("paints individual surfaces and floors, leaves missing tiles alone, and supports conflict-aware undo", () => {
  const bp = rooms(), op = materialPaintOp(bp, 1, "floor", ["2:2", "2:2", "0:0"], "parquet")!;
  expect(op).toEqual({ t: "floor.paint", level: 1, cells: ["2:2"], material: "parquet", existingOnly: true });
  const after = apply(bp, op), inverse = inverseOp(bp, op)!;
  expect(apply(after, inverse)).toEqual(bp);
  const otherFloor = apply(after, { t: "floor.paint", level: 0, cells: ["2:2"], material: "marble" });
  expect(undoCheck(otherFloor, inverse)).toBe(undoCheck(after, inverse));
  const conflict = apply(after, { t: "floor.paint", level: 1, cells: ["2:2"], material: "marble" });
  expect(undoCheck(conflict, inverse)).not.toBe(undoCheck(after, inverse));
  expect(materialPaintOp(after, 1, "floor", ["2:2"], "parquet")).toBeNull();
  expect(materialPaintOp(bp, 1, "wall", ["h:0:0"], "brick_red")).toBeNull();
});

it.each([0, 1, 2, 3] as const)("keeps stair and lift openings unchanged with rotation %i", (rot) => {
  const bp = rooms(), level = bp.levels[1]!;
  const stairs = [...catalog.furniture.values()].find((v) => v.stairs)!;
  const lift = [...catalog.furniture.values()].find((v) => v.lift)!;
  bp.levels[0]!.objects.stairs0001 = { id: "stairs0001", catalogId: stairs.id, x: 2, z: 1, rot };
  bp.levels[0]!.objects.lift000001 = { id: "lift000001", catalogId: lift.id, x: 6, z: 1, rot };
  const holes = new Set([...stairHoles(bp, 1, catalog), ...liftShafts(bp, 1, catalog)]);
  for (const key of holes) level.tiles[key] = { material: "oak" };
  const op = materialPaintOp(bp, 1, "floor", Object.keys(level.tiles), "marble")!, after = apply(bp, op);
  for (const key of holes) expect(after.levels[1]!.tiles[key]!.material).toBe("oak");
  expect(stairHoles(after, 1, catalog)).toEqual(stairHoles(bp, 1, catalog));
  expect(liftShafts(after, 1, catalog)).toEqual(liftShafts(bp, 1, catalog));
});

it("loads old homes without new saved fields and round-trips all new material IDs", () => {
  const old = rooms(), raw = JSON.parse(JSON.stringify(old)); raw.schema = 2; delete raw.funds;
  const bp = upgradeBlueprint(raw);
  expect(bp.levels[1]!.walls["h:2:1"]).toEqual({ style: "plaster_cream" });
  let updated = bp;
  for (const s of catalog.wallStyles.values()) updated = apply(updated, { t: "walls.add", level: 1, edges: ["h:2:1"], style: s.id });
  for (const f of catalog.floorMaterials.values()) updated = apply(updated, { t: "floor.paint", level: 1, cells: ["2:2"], material: f.id });
  expect(upgradeBlueprint(JSON.parse(JSON.stringify(updated)))).toEqual(updated);
  expect(Object.keys(updated.levels[1]!.walls["h:2:1"]!)).toEqual(["style"]);
  expect(Object.keys(updated.levels[1]!.tiles["2:2"]!)).toEqual(["material"]);
  expect(applyOp(bp, { t: "walls.add", level: 1, edges: ["h:2:1"], style: "untrusted" }).ok).toBe(false);
});

it("chunks large rooms into one valid atomic batch", () => {
  const bp = emptyBlueprint(40, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) bp.levels[0]!.tiles[cellKey(x, z)] = { material: "oak" };
  const op = materialPaintOp(bp, 0, "floor", Object.keys(bp.levels[0]!.tiles), "marble")!;
  expect(op.t).toBe("batch"); expect(Op.safeParse(op).success).toBe(true);
  expect(apply(apply(bp, op), inverseOp(bp, op)!)).toEqual(bp);
});

it("does not resurrect surfaces removed before a delayed repaint, including inverse generation", () => {
  const bp = rooms();
  const wall = materialPaintOp(bp, 1, "wall", ["h:1:1"], "glass_framed")!;
  const floor = materialPaintOp(bp, 1, "floor", ["1:1"], "marble")!;
  const removed = apply(apply(bp, { t: "walls.remove", level: 1, edges: ["h:1:1"] }), { t: "floor.paint", level: 1, cells: ["1:1"], material: null });
  expect(apply(apply(removed, wall), floor)).toEqual(removed);
  expect(inverseOp(removed, wall)).toBeNull(); expect(inverseOp(removed, floor)).toBeNull();
});
