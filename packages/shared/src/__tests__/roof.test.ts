import { describe, expect, it } from "vitest";
import { emptyBlueprint, upgradeBlueprint, type Blueprint } from "../blueprint";
import { cellsBetween, edgesBetween, enclosedCells } from "../grid";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { inverseOp } from "../undo";

function apply(bp: Blueprint, op: Op): Blueprint {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}

describe("roofs", () => {
  it("go on and come off cells, and undo puts back what was there", () => {
    let bp = apply(emptyBlueprint(10, 10), { t: "roof.paint", level: 0, cells: cellsBetween(1, 1, 2, 2), style: "roof_slate" });
    expect(Object.keys(bp.levels[0]!.roofs).sort()).toEqual(["1:1", "1:2", "2:1", "2:2"]);
    const recolour: Op = { t: "roof.paint", level: 0, cells: cellsBetween(2, 2, 3, 2), style: "roof_terracotta" };
    const undo = inverseOp(bp, recolour)!;
    const after = apply(bp, recolour);
    expect(after.levels[0]!.roofs["2:2"]).toEqual({ style: "roof_terracotta" });
    bp = apply(after, undo);
    expect(bp.levels[0]!.roofs).toEqual(apply(emptyBlueprint(10, 10), { t: "roof.paint", level: 0, cells: cellsBetween(1, 1, 2, 2), style: "roof_slate" }).levels[0]!.roofs);
    bp = apply(bp, { t: "roof.paint", level: 0, cells: ["1:1"], style: null });
    expect(bp.levels[0]!.roofs["1:1"]).toBeUndefined();
  });

  it("refuse unknown styles and cells off the lot", () => {
    const bp = emptyBlueprint(4, 4);
    expect(applyOp(bp, { t: "roof.paint", level: 0, cells: ["0:0"], style: "roof_gold" })).toEqual({ ok: false, reason: "unknown-roof" });
    expect(applyOp(bp, { t: "roof.paint", level: 0, cells: ["4:0"], style: "roof_slate" })).toEqual({ ok: false, reason: "out-of-lot" });
  });

  it("are added to houses saved before roofs existed", () => {
    const old = { schema: 2, lot: { w: 4, d: 4 }, levels: [{ walls: {}, tiles: {}, objects: {}, openings: {} }] } as unknown as Blueprint;
    expect(upgradeBlueprint(old).levels[0]!.roofs).toEqual({});
  });
});

describe("enclosedCells", () => {
  it("finds the inside of a closed room, even with a door gap left as wall", () => {
    const walls: Record<string, { style: string }> = {};
    for (const e of [...edgesBetween(1, 1, 4, 1), ...edgesBetween(1, 3, 4, 3), ...edgesBetween(1, 1, 1, 3), ...edgesBetween(4, 1, 4, 3)]) walls[e] = { style: "x" };
    expect(enclosedCells(walls, 6, 6).sort()).toEqual(cellsBetween(1, 1, 3, 2).sort());
    // knock a hole in it and nothing is inside any more
    delete walls["h:2:1"];
    expect(enclosedCells(walls, 6, 6)).toEqual([]);
  });

  it("counts walls along the lot's edge", () => {
    const walls: Record<string, { style: string }> = {};
    for (const e of [...edgesBetween(0, 0, 2, 0), ...edgesBetween(0, 2, 2, 2), ...edgesBetween(0, 0, 0, 2), ...edgesBetween(2, 0, 2, 2)]) walls[e] = { style: "x" };
    expect(enclosedCells(walls, 4, 4).sort()).toEqual(cellsBetween(0, 0, 1, 1).sort());
  });
});
