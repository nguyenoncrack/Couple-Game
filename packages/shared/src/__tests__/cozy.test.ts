import { describe, expect, it } from "vitest";
import { catalog, emptyBlueprint, applyOp, costOf, cellsBetween, edgesBetween, STARTING_FUNDS, upgradeBlueprint, withStarterHouse, type Blueprint, type Op } from "../index";

const FURNITURE = ["window_bench", "reading_lamp", "blanket_basket", "umbrella_stand", "tea_set_two", "rug_patterned"];

/** A walled, floored room with a window in the north wall, for placing things in. */
function room(): Blueprint {
  let bp = emptyBlueprint(24, 20);
  const ops: Op[] = [
    ...[
      [4, 4, 12, 4],
      [12, 4, 12, 10],
      [12, 10, 4, 10],
      [4, 10, 4, 4],
    ].map(([a, b, c, d]) => ({ t: "walls.add" as const, level: 0, edges: edgesBetween(a!, b!, c!, d!), style: "cedar_planks" })),
    { t: "walls.add", level: 0, edges: edgesBetween(12, 4, 12, 6), style: "frosted_glass_framed" },
    { t: "floor.paint", level: 0, cells: cellsBetween(4, 4, 11, 9), material: "slate_rain" },
    { t: "opening.place", level: 0, id: "winfrost01", catalogId: "window_frosted_wide", dir: "h", x: 7, z: 4, flip: false },
    { t: "opening.place", level: 0, id: "winfrost02", catalogId: "window_frosted", dir: "h", x: 10, z: 4, flip: false },
  ];
  for (const op of ops) {
    const r = applyOp(bp, op);
    if (!r.ok) throw new Error(`${op.t}: ${r.reason}`);
    bp = r.blueprint;
  }
  return bp;
}

describe("the cozy catalog", () => {
  it("has the six pieces, each with a price, a footprint and a category of its own", () => {
    for (const id of FURNITURE) {
      const item = catalog.furniture.get(id)!;
      expect(item, id).toBeDefined();
      expect(item.category).toBe("cozy");
      expect(item.price).toBeGreaterThan(0);
      expect(item.footprint[0]).toBeGreaterThanOrEqual(1);
      expect(item.tags!.length).toBeGreaterThan(2);
    }
    expect(catalog.furniture.get("rug_patterned")!.layer).toBe("rug");
    expect(catalog.furniture.get("rug_patterned")!.footprint).toEqual([3, 2]);
    expect(catalog.furniture.get("window_bench")!.footprint).toEqual([2, 1]);
  });

  it("has a two-seat window bench whose sitters face the wall behind it", () => {
    const bench = catalog.furniture.get("window_bench")!;
    expect(bench.windowSeat).toBe(true);
    const sit = bench.interactions!.find((i) => i.action === "sit")!;
    expect(sit.slots).toHaveLength(2);
    // side by side, both facing back (-z) towards the window, both entered from the room side
    expect(new Set(sit.slots.map((s) => s.face))).toEqual(new Set([2]));
    expect(sit.slots.map((s) => s.pose[0])).toEqual([0.5, 1.5]);
    for (const s of sit.slots) expect(s.stand).toEqual([[Math.floor(s.pose[0]), 1]]);
  });

  it("has cedar walls, rain slate floors and framed frosted windows", () => {
    const cedar = catalog.wallStyles.get("cedar_planks")!;
    expect(cedar.finish).toBe("wood");
    expect(cedar.surface).toBe("shiplap");
    const frostedWall = catalog.wallStyles.get("frosted_glass_framed")!;
    expect(frostedWall.surface).toBe("frosted");
    expect(frostedWall.name).toBe("Framed frosted glass");
    // (the clear glass wall is still there beside it)
    expect(catalog.wallStyles.has("glass_framed")).toBe(true);
    const slate = catalog.floorMaterials.get("slate_rain")!;
    expect(slate.surface).toBe("slate");
    // (the older charcoal slate is still there)
    expect(catalog.floorMaterials.has("slate_charcoal")).toBe(true);
    for (const id of ["window_frosted", "window_frosted_wide"]) {
      const o = catalog.openings.get(id)!;
      expect(o.kind).toBe("window");
      expect(o.price).toBeGreaterThan(0);
      expect(o.model.frosted).toBe(true);
    }
    expect(catalog.openings.get("window_frosted_wide")!.width).toBe(2);
  });
});

describe("building with the cozy catalog", () => {
  it("places every piece, charges its price, and survives a save and reload", () => {
    let bp = room();
    const items: [string, number, number][] = [
      ["window_bench", 6, 5],
      ["reading_lamp", 10, 8],
      ["blanket_basket", 5, 8],
      ["umbrella_stand", 9, 5],
      ["tea_set_two", 8, 8],
      ["rug_patterned", 6, 6],
    ];
    const before = bp.funds;
    let spent = 0;
    for (const [catalogId, x, z] of items) {
      const r = applyOp(bp, { t: "object.place", level: 0, id: `cozy_${catalogId}`.slice(0, 20), catalogId, x, z, rot: 0 });
      expect(r.ok, `${catalogId}: ${r.ok ? "" : r.reason}`).toBe(true);
      if (r.ok) bp = r.blueprint;
      spent += catalog.furniture.get(catalogId)!.price;
    }
    // (the walls, floor and windows cost too: just check the furniture came out of the funds)
    expect(bp.funds).toBeLessThanOrEqual(before - spent);
    expect(Object.keys(bp.levels[0]!.objects)).toHaveLength(6);
    // the JSON a house is saved as round-trips exactly, and upgrading it changes nothing
    const reloaded = JSON.parse(JSON.stringify(bp)) as Blueprint;
    expect(reloaded).toEqual(bp);
    expect(upgradeBlueprint(reloaded)).toEqual(bp);
    expect(reloaded.levels[0]!.walls[Object.keys(reloaded.levels[0]!.walls)[0]!]!.style).toBe("cedar_planks");
  });

  it("won't put two things on the same spot, but lets a rug lie under furniture", () => {
    let bp = room();
    const place = (id: string, catalogId: string, x: number, z: number) => {
      const r = applyOp(bp, { t: "object.place", level: 0, id, catalogId, x, z, rot: 0 });
      if (r.ok) bp = r.blueprint;
      return r;
    };
    expect(place("benchone01", "window_bench", 6, 5).ok).toBe(true);
    const clash = place("benchtwo01", "window_bench", 7, 5);
    expect(clash.ok).toBe(false);
    expect(place("rugone0001", "rug_patterned", 5, 5).ok).toBe(true);
    expect(place("teaone0001", "tea_set_two", 5, 7).ok).toBe(true);
  });

  it("leaves older homes alone: they load and work exactly as before", () => {
    // a house with nothing new in it, the starter house, still builds, costs the same and has no cozy items
    const starter = withStarterHouse(emptyBlueprint(24, 20));
    expect(starter.funds).toBe(STARTING_FUNDS);
    for (const level of starter.levels) for (const o of Object.values(level.objects)) expect(catalog.furniture.get(o.catalogId)!.category).not.toBe("cozy");
    expect(costOf(emptyBlueprint(24, 20), { t: "object.place", level: 0, id: "oldstuff01", catalogId: "sofa_cozy", x: 2, z: 2, rot: 0 })).toBe(catalog.furniture.get("sofa_cozy")!.price);
  });
});
