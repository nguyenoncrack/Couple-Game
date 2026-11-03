import { describe, expect, it } from "vitest";
import { emptyBlueprint, upgradeBlueprint, type Blueprint } from "../blueprint";
import { edgesBetween } from "../grid";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { starterHouseOp } from "../starter";
import { inverseOp, undoCheck } from "../undo";

function apply(bp: Blueprint, op: Op): Blueprint {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}

/** A 6-long wall along z = 2. */
const walled = () => apply(emptyBlueprint(10, 10), { t: "walls.add", level: 0, edges: edgesBetween(0, 2, 6, 2), style: "plaster_cream" });

describe("doors and windows", () => {
  it("go only in walls, and never overlap each other", () => {
    let bp = walled();
    expect(applyOp(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 2, z: 3, flip: false })).toEqual({ ok: false, reason: "needs-wall" });
    // French doors are two wide, so they need two edges of wall
    expect(applyOp(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_french", dir: "h", x: 5, z: 2, flip: false })).toEqual({ ok: false, reason: "needs-wall" });
    bp = apply(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_french", dir: "h", x: 1, z: 2, flip: false });
    expect(applyOp(bp, { t: "opening.place", level: 0, id: "win0000001", catalogId: "window_small", dir: "h", x: 2, z: 2, flip: false })).toEqual({ ok: false, reason: "overlaps" });
    bp = apply(bp, { t: "opening.place", level: 0, id: "win0000001", catalogId: "window_small", dir: "h", x: 3, z: 2, flip: false });
    // moving checks against everything but itself
    bp = apply(bp, { t: "opening.move", level: 0, id: "door000001", dir: "h", x: 0, z: 2, flip: true });
    expect(bp.levels[0]!.openings.door000001).toMatchObject({ x: 0, flip: true });
    expect(applyOp(bp, { t: "object.place", level: 0, id: "win0000001", catalogId: "fridge", x: 5, z: 5, rot: 0 })).toEqual({ ok: false, reason: "id-taken" });
  });

  it("go away with the wall they're in", () => {
    let bp = walled();
    bp = apply(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 2, z: 2, flip: false });
    bp = apply(bp, { t: "opening.place", level: 0, id: "win0000001", catalogId: "window_small", dir: "h", x: 4, z: 2, flip: false });
    bp = apply(bp, { t: "walls.remove", level: 0, edges: ["h:2:2"] });
    expect(Object.keys(bp.levels[0]!.openings)).toEqual(["win0000001"]);
  });

  it("upgrades houses saved before doors existed", () => {
    const old = { schema: 1, lot: { w: 4, d: 4 }, levels: [{ walls: {}, tiles: {}, objects: {} }] };
    const bp = upgradeBlueprint(old as never);
    expect(bp.schema).toBe(2);
    expect(bp.levels[0]!.openings).toEqual({});
  });
});

describe("batches", () => {
  it("apply all or nothing", () => {
    const bp = walled();
    const bad: Op = {
      t: "batch",
      ops: [
        { t: "object.place", level: 0, id: "chair00001", catalogId: "armchair_reading", x: 0, z: 0, rot: 0 },
        { t: "object.place", level: 0, id: "chair00002", catalogId: "armchair_reading", x: 0, z: 0, rot: 0 },
      ],
    };
    expect(applyOp(bp, bad)).toEqual({ ok: false, reason: "overlaps" });
    expect(bp.levels[0]!.objects).toEqual({});
  });
});

describe("undo", () => {
  /** Apply op, then its inverse, and expect to be back where we started. */
  function roundTrip(bp: Blueprint, op: Op) {
    const inv = inverseOp(bp, op);
    expect(inv).not.toBeNull();
    const after = apply(bp, op);
    const back = apply(after, inv!);
    expect(back).toEqual(bp);
    return after;
  }

  it("reverses every kind of edit", () => {
    let bp = walled();
    bp = roundTrip(bp, { t: "walls.add", level: 0, edges: edgesBetween(0, 2, 8, 2), style: "brick_red" });
    bp = roundTrip(bp, { t: "floor.paint", level: 0, cells: ["0:0", "1:0", "0:1"], material: "oak" });
    bp = roundTrip(bp, { t: "floor.paint", level: 0, cells: ["0:0", "5:5"], material: "stone" });
    bp = roundTrip(bp, { t: "floor.paint", level: 0, cells: ["0:0", "1:0"], material: null });
    bp = roundTrip(bp, { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 0, z: 4, rot: 0 });
    bp = roundTrip(bp, { t: "object.move", level: 0, id: "sofa000001", x: 3, z: 5, rot: 1 });
    bp = roundTrip(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 2, z: 2, flip: false });
    bp = roundTrip(bp, { t: "opening.move", level: 0, id: "door000001", dir: "h", x: 4, z: 2, flip: true });
    // removing a wall takes its door, and undo brings both back
    roundTrip(bp, { t: "walls.remove", level: 0, edges: edgesBetween(3, 2, 6, 2) });
    bp = roundTrip(bp, { t: "walls.remove", level: 0, edges: ["h:5:2"] });
    bp = roundTrip(bp, { t: "object.remove", level: 0, id: "sofa000001" });
    roundTrip(bp, { t: "opening.remove", level: 0, id: "door000001" });
  });

  it("reverses a batch, last step first", () => {
    const bp = walled();
    roundTrip(bp, {
      t: "batch",
      ops: [
        { t: "walls.add", level: 0, edges: ["v:6:2"], style: "plaster_sky" },
        { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "v", x: 6, z: 2, flip: false },
        { t: "object.place", level: 0, id: "lamp000001", catalogId: "floor_lamp", x: 7, z: 7, rot: 0 },
        { t: "object.move", level: 0, id: "lamp000001", x: 8, z: 8, rot: 2 },
      ],
    });
  });

  it("notices when someone else changed what you're about to undo", () => {
    const op: Op = { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 0, z: 4, rot: 0 };
    const after = apply(walled(), op);
    const check = undoCheck(after, op);
    expect(undoCheck(apply(after, { t: "floor.paint", level: 0, cells: ["9:9"], material: "oak" }), op)).toBe(check);
    expect(undoCheck(apply(after, { t: "object.move", level: 0, id: "sofa000001", x: 1, z: 4, rot: 0 }), op)).not.toBe(check);
  });

  it("has nothing to undo for an edit that changed nothing", () => {
    expect(inverseOp(walled(), { t: "walls.add", level: 0, edges: ["h:0:2"], style: "plaster_cream" })).toBeNull();
  });
});

describe("starter house", () => {
  it("fits on the default lot in one batch and undoes cleanly", () => {
    let n = 0;
    const op = starterHouseOp(0, () => `starter${String(++n).padStart(4, "0")}`);
    const bp = emptyBlueprint();
    const after = apply(bp, op);
    const l = after.levels[0]!;
    expect(Object.keys(l.openings).length).toBeGreaterThan(10);
    expect(Object.values(l.objects).filter((o) => o.catalogId === "bed_double")).toHaveLength(2);
    expect(Object.values(l.objects).some((o) => o.catalogId === "pool_rect")).toBe(true);
    expect(apply(after, inverseOp(bp, op)!)).toEqual(bp);
  });
});
