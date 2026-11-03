import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { catalog } from "../catalog";
import { cellsBetween, edgesBetween, interiorEdges } from "../grid";
import { Op } from "../ops";
import { applyOp } from "../rules";

function apply(bp: Blueprint, op: Op): Blueprint {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}

describe("grid helpers", () => {
  it("lists unit edges along a straight line in either direction", () => {
    expect(edgesBetween(2, 3, 5, 3)).toEqual(["h:2:3", "h:3:3", "h:4:3"]);
    expect(edgesBetween(1, 4, 1, 2)).toEqual(["v:1:2", "v:1:3"]);
    expect(edgesBetween(0, 0, 2, 2)).toEqual([]);
  });

  it("finds the edges inside a footprint", () => {
    expect(interiorEdges(0, 0, 1, 1)).toEqual([]);
    expect(interiorEdges(0, 0, 2, 1)).toEqual(["v:1:0"]);
    expect(interiorEdges(0, 0, 2, 2).sort()).toEqual(["h:0:1", "h:1:1", "v:1:0", "v:1:1"]);
  });
});

describe("applyOp", () => {
  it("adds, restyles and removes walls without touching the input", () => {
    const bp = emptyBlueprint(10, 10);
    const a = apply(bp, { t: "walls.add", level: 0, edges: edgesBetween(0, 0, 4, 0), style: "plaster_cream" });
    expect(Object.keys(a.levels[0]!.walls)).toHaveLength(4);
    expect(bp.levels[0]!.walls).toEqual({});
    const b = apply(a, { t: "walls.add", level: 0, edges: ["h:0:0"], style: "brick_red" });
    expect(b.levels[0]!.walls["h:0:0"]).toEqual({ style: "brick_red" });
    const c = apply(b, { t: "walls.remove", level: 0, edges: ["h:0:0", "h:9:9"] });
    expect(Object.keys(c.levels[0]!.walls)).toHaveLength(3);
  });

  it("rejects walls outside the lot or with unknown styles", () => {
    const bp = emptyBlueprint(4, 4);
    expect(applyOp(bp, { t: "walls.add", level: 0, edges: ["h:4:0"], style: "plaster_cream" })).toEqual({ ok: false, reason: "out-of-lot" });
    expect(applyOp(bp, { t: "walls.add", level: 0, edges: ["v:4:0"], style: "plaster_cream" }).ok).toBe(true);
    expect(applyOp(bp, { t: "walls.add", level: 0, edges: ["h:0:0"], style: "nope" })).toEqual({ ok: false, reason: "unknown-style" });
    expect(applyOp(bp, { t: "walls.add", level: 0, edges: ["x:0:0"], style: "plaster_cream" })).toEqual({ ok: false, reason: "bad-edge" });
  });

  it("paints and clears floor tiles", () => {
    const bp = apply(emptyBlueprint(6, 6), { t: "floor.paint", level: 0, cells: cellsBetween(0, 0, 1, 1), material: "oak" });
    expect(Object.keys(bp.levels[0]!.tiles)).toHaveLength(4);
    const cleared = apply(bp, { t: "floor.paint", level: 0, cells: ["0:0"], material: null });
    expect(Object.keys(cleared.levels[0]!.tiles)).toHaveLength(3);
    expect(applyOp(bp, { t: "floor.paint", level: 0, cells: ["6:0"], material: "oak" })).toEqual({ ok: false, reason: "out-of-lot" });
  });

  it("places furniture inside the lot and keeps floor items from overlapping", () => {
    let bp = emptyBlueprint(8, 8);
    bp = apply(bp, { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 0, z: 0, rot: 0 });
    // the sofa is 2×1, so (1,0) is taken
    expect(applyOp(bp, { t: "object.place", level: 0, id: "chair00001", catalogId: "armchair_reading", x: 1, z: 0, rot: 0 })).toEqual({ ok: false, reason: "overlaps" });
    // a rug can go under it
    bp = apply(bp, { t: "object.place", level: 0, id: "rug0000001", catalogId: "rug_woven", x: 0, z: 0, rot: 0 });
    // rotated a quarter turn it's 1×2, which fits at the far edge only vertically
    expect(applyOp(bp, { t: "object.place", level: 0, id: "sofa000002", catalogId: "sofa_cozy", x: 7, z: 5, rot: 0 })).toEqual({ ok: false, reason: "out-of-lot" });
    expect(applyOp(bp, { t: "object.place", level: 0, id: "sofa000002", catalogId: "sofa_cozy", x: 7, z: 5, rot: 1 }).ok).toBe(true);
    expect(applyOp(bp, { t: "object.place", level: 0, id: "sofa000001", catalogId: "fridge", x: 5, z: 5, rot: 0 })).toEqual({ ok: false, reason: "id-taken" });
  });

  it("won't put a wall through furniture or furniture across a wall", () => {
    let bp = emptyBlueprint(8, 8);
    bp = apply(bp, { t: "object.place", level: 0, id: "bed0000001", catalogId: "bed_double", x: 2, z: 2, rot: 0 });
    expect(applyOp(bp, { t: "walls.add", level: 0, edges: edgesBetween(3, 0, 3, 6), style: "plaster_cream" })).toEqual({ ok: false, reason: "blocks-furniture" });
    // along the bed's edge is fine
    bp = apply(bp, { t: "walls.add", level: 0, edges: edgesBetween(2, 0, 2, 6), style: "plaster_cream" });
    expect(applyOp(bp, { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 1, z: 5, rot: 0 })).toEqual({ ok: false, reason: "wall-in-the-way" });
  });

  it("moves, rotates and removes objects; moving checks overlap against everything but itself", () => {
    let bp = emptyBlueprint(8, 8);
    bp = apply(bp, { t: "object.place", level: 0, id: "table00001", catalogId: "dining_table", x: 0, z: 0, rot: 0 });
    bp = apply(bp, { t: "object.place", level: 0, id: "fridge0001", catalogId: "fridge", x: 4, z: 0, rot: 0 });
    bp = apply(bp, { t: "object.move", level: 0, id: "table00001", x: 1, z: 0, rot: 0 });
    expect(bp.levels[0]!.objects.table00001).toMatchObject({ x: 1, z: 0 });
    expect(applyOp(bp, { t: "object.move", level: 0, id: "table00001", x: 3, z: 0, rot: 0 })).toEqual({ ok: false, reason: "overlaps" });
    bp = apply(bp, { t: "object.move", level: 0, id: "table00001", x: 1, z: 0, rot: 1 });
    expect(bp.levels[0]!.objects.table00001!.rot).toBe(1);
    bp = apply(bp, { t: "object.remove", level: 0, id: "table00001" });
    expect(applyOp(bp, { t: "object.remove", level: 0, id: "table00001" })).toEqual({ ok: false, reason: "not-found" });
    expect(applyOp(bp, { t: "object.move", level: 0, id: "table00001", x: 0, z: 0, rot: 0 })).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects ops for floors that don't exist", () => {
    expect(applyOp(emptyBlueprint(), { t: "walls.remove", level: 1, edges: ["h:0:0"] })).toEqual({ ok: false, reason: "no-level" });
  });
});

describe("catalog", () => {
  it("loads and every item has a model kind and a sane footprint", () => {
    expect(catalog.furniture.size).toBeGreaterThan(10);
    for (const item of catalog.furniture.values()) {
      expect(item.model.kind).toBeTruthy();
      expect(item.footprint[0] * item.footprint[1]).toBeGreaterThan(0);
    }
    expect(catalog.wallStyles.has("plaster_cream")).toBe(true);
    expect(catalog.floorMaterials.has("oak")).toBe(true);
  });
});
