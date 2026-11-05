import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { catalog, loadCatalog, swatchOf, variantsOf, type FurnitureItem } from "../catalog";
import furnitureData from "../catalog/furniture.json";
import furnitureMoreData from "../catalog/furniture-more.json";
import openingsData from "../catalog/openings.json";
import piecesData from "../catalog/pieces.json";
import recipesData from "../catalog/recipes.json";
import { cellKey, type Rot } from "../grid";
import { slotsOf, walkableCells } from "../life/interactions";
import { Life } from "../life/engine";
import { buildNav, findPath, walkable } from "../life/nav";
import { needsAt, START_NEEDS } from "../life/needs";
import { activityAt, emptyLife } from "../life/state";
import { Op } from "../ops";
import { applyOp, footprintOf } from "../rules";

/**
 * The furniture range: every kind of piece a home needs, each in a few colours, each placeable and usable from
 * where it says you stand, and the useful ones looked after by free will.
 */

let n = 0;
const ids = () => `id${String(++n).padStart(8, "0")}`;

function apply(bp: Blueprint, op: Op): Blueprint {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}
const tryApply = (bp: Blueprint, op: Op) => applyOp(bp, Op.parse(op));

/** The pieces asked for, by the catalog item standing for each (others are its colours). */
const RANGE = {
  seating: ["dining_chair", "armchair_reading", "sofa_cozy", "sofa_sage", "sectional_oat"],
  tables: ["dining_table", "coffee_table_oak", "desk_oak", "nightstand"],
  bedroom: ["bed_single_oak", "bed_double", "dresser_oak", "wardrobe_oak", "bookshelf"],
  kitchenBath: ["counter", "counter_sink", "stove", "fridge", "toilet", "shower_white", "bathtub"],
  decor: ["floor_lamp", "arc_lamp_brass", "rug_woven", "rug_round_cream", "mirror_oak", "plant_fiddle", "bench_oak", "picnic_natural", "lounger"],
};

describe("furniture range", () => {
  it.each(Object.values(RANGE).flat())("%s is in the catalog in two or three colours, each its own look", (id) => {
    const colors = variantsOf(catalog, id);
    expect(colors[0]?.id).toBe(id);
    expect(colors.length).toBeGreaterThanOrEqual(2);
    expect(colors.length).toBeLessThanOrEqual(3);
    expect(new Set(colors.map((c) => swatchOf(catalog, c))).size).toBe(colors.length);
    expect(new Set(colors.map((c) => JSON.stringify(c.model))).size).toBe(colors.length);
    expect(new Set(colors.map((c) => c.name)).size).toBe(colors.length);
    // a colour is the same piece: the same model, size, place in the catalog and uses
    for (const c of colors) {
      expect(c.model.kind).toBe(colors[0]!.model.kind);
      expect(c.footprint).toEqual(colors[0]!.footprint);
      expect(c.category).toBe(colors[0]!.category);
      expect(c.layer).toBe(colors[0]!.layer);
      expect(c.interactions).toEqual(colors[0]!.interactions);
      expect(c.price).toBeGreaterThan(0);
    }
  });

  it("gives the new pieces models of their own", () => {
    const kinds = (ids: string[]) => ids.map((id) => catalog.furniture.get(id)!.model.kind);
    expect(new Set(kinds(["sectional_oat", "desk_oak", "dresser_oak", "wardrobe_oak", "shower_white", "mirror_oak", "bench_oak", "picnic_natural", "arc_lamp_brass", "rug_round_cream"])).size).toBe(10);
  });

  it("keeps every item that was already in the catalog, as it was", () => {
    for (const old of furnitureData) expect(catalog.furniture.get(old.id)).toMatchObject({ id: old.id, price: old.price, footprint: old.footprint, model: old.model });
  });

  it("won't load a colour of something that isn't there, or of another colour", () => {
    const raw = { openings: openingsData, pieces: piecesData, recipes: recipesData };
    const chair = furnitureData.find((i) => i.id === "dining_chair")!;
    expect(() => loadCatalog({ ...raw, furniture: [...furnitureData, { ...chair, id: "x", variantOf: "nope" }] })).toThrow(/colour/);
    expect(() => loadCatalog({ ...raw, furniture: [...furnitureData, ...furnitureMoreData, { ...chair, id: "x", variantOf: "dining_chair_white" }] })).toThrow(/colour/);
    expect(() => loadCatalog({ ...raw, furniture: [...furnitureData, { ...chair, id: "x", category: "living", variantOf: "dining_chair" }] })).toThrow(/colour/);
  });
});

/** Each item alone in the middle of an open lot, turned each way. */
function alone(item: FurnitureItem, rot: Rot) {
  const id = "piece00001";
  const bp = apply(emptyBlueprint(14, 14), { t: "object.place", level: 0, id, catalogId: item.id, x: 5, z: 5, rot });
  return { bp, o: bp.levels[0]!.objects[id]! };
}

const usable = [...catalog.furniture.values()].filter((i) => i.interactions?.length && !i.lift && !i.stairs);

describe("using furniture", () => {
  it.each(usable.map((i) => [i.id, i] as const))("%s can be walked up to and used from every side it's turned", (_id, item) => {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const { bp, o } = alone(item, rot);
      const nav = buildNav(bp);
      const f = footprintOf(item, o);
      for (const s of slotsOf(o)) {
        // somewhere to stand that's clear, and a way there from the corner of the lot
        const clear = s.stand.filter(([x, z]) => walkable(nav, x, z));
        expect(clear.length, `${item.id} rot ${rot} slot ${s.slot}`).toBeGreaterThan(0);
        expect(findPath(nav, [0, 0], clear)).not.toBeNull();
        // where you end up is on (or by: the floor in front of a TV) the piece, a short step from where you stood
        expect(s.pose.x).toBeGreaterThan(f.x - 1.5);
        expect(s.pose.x).toBeLessThan(f.x + f.w + 1.5);
        expect(s.pose.z).toBeGreaterThan(f.z - 1.5);
        expect(s.pose.z).toBeLessThan(f.z + f.d + 1.5);
        const step = Math.min(...clear.map(([x, z]) => Math.hypot(x + 0.5 - s.pose.x, z + 0.5 - s.pose.z)));
        expect(step, `${item.id} rot ${rot} slot ${s.slot}`).toBeLessThan(1.6);
      }
    }
  });

  it("leaves the front of the corner sectional open to walk on, but not to put things on", () => {
    const item = catalog.furniture.get("sectional_oat")!;
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const { bp, o } = alone(item, rot);
      const nav = buildNav(bp);
      const open = walkableCells(item, o);
      const f = footprintOf(item, o);
      expect(open.size).toBe(2);
      for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) expect(walkable(nav, x, z)).toBe(open.has(cellKey(x, z)));
      // the seats are stood up from there
      for (const s of slotsOf(o, "sit")) expect(open.has(cellKey(...s.stand[0]!))).toBe(true);
      const [x, z] = [...open][0]!.split(":").map(Number) as [number, number];
      expect(tryApply(bp, { t: "object.place", level: 0, id: "chair00001", catalogId: "dining_chair", x, z, rot: 0 }).ok).toBe(false);
      // a rug can still go under it
      expect(tryApply(bp, { t: "object.place", level: 0, id: "rug0000001", catalogId: "rug_blue", x: f.x, z: f.z, rot: 0 }).ok).toBe(true);
    }
  });

  it("serves dinner on the picnic table and seats you at its benches", () => {
    const item = catalog.furniture.get("picnic_natural")!;
    expect(item.surface).toBe(true);
    const { o } = alone(item, 0);
    expect(slotsOf(o, "sit")).toHaveLength(4);
  });
});

const T0 = 1_000_000;

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(life: Life, bp: Blueprint, from: number, ms: number, each?: (t: number) => void) {
  let t = from;
  const end = from + ms;
  while (t < end) {
    t = Math.min(end, t + 1000, Math.max(t + 250, life.nextEvent(t) ?? end));
    life.tick(bp, t);
    each?.(t);
  }
  return t;
}

describe("free will with the new furniture", () => {
  it("takes a shower when they need a wash, and comes out clean", () => {
    let bp = emptyBlueprint(10, 10);
    bp = apply(bp, { t: "object.place", level: 0, id: "shower0001", catalogId: "shower_sage", x: 4, z: 2, rot: 0 });
    const life = new Life(emptyLife(), catalog, ids, seeded(4)).enableFreeWill();
    life.ensureAvatar("ana", bp, T0);
    life.state.avatars.ana!.needs = { v: { ...START_NEEDS, hygiene: 10 }, at: T0, live: true };
    life.tick(bp, T0);
    const a = life.state.avatars.ana!;
    expect(a.use).toMatchObject({ action: "shower", objectId: "shower0001" });
    const seen = new Set<string>();
    run(life, bp, T0, 90_000, (t) => seen.add(activityAt(a, t)));
    expect(seen).toContain("shower");
    expect(needsAt(a, T0 + 90_000).hygiene).toBeGreaterThan(80);
  });

  it("rests on a garden bench, or on the sectional's chaise, when tired and there's no bed", () => {
    for (const [catalogId, action] of [["bench_green", "sit"], ["sectional_slate", "lounge"]] as const) {
      let bp = emptyBlueprint(10, 10);
      bp = apply(bp, { t: "object.place", level: 0, id: "seat000001", catalogId, x: 4, z: 3, rot: 0 });
      const life = new Life(emptyLife(), catalog, ids, seeded(5)).enableFreeWill();
      life.ensureAvatar("ana", bp, T0);
      life.state.avatars.ana!.needs = { v: { ...START_NEEDS, energy: 8 }, at: T0, live: true };
      life.tick(bp, T0);
      expect(life.state.avatars.ana!.use, catalogId).toMatchObject({ action, objectId: "seat000001" });
    }
  });

  it("sleeps in a single bed", () => {
    let bp = emptyBlueprint(10, 10);
    bp = apply(bp, { t: "object.place", level: 0, id: "bed0000001", catalogId: "bed_single_walnut", x: 4, z: 3, rot: 1 });
    const life = new Life(emptyLife(), catalog, ids, seeded(6)).enableFreeWill();
    life.ensureAvatar("ana", bp, T0);
    life.state.avatars.ana!.needs = { v: { ...START_NEEDS, energy: 5 }, at: T0, live: true };
    life.tick(bp, T0);
    expect(life.state.avatars.ana!.use).toMatchObject({ action: "sleep", objectId: "bed0000001" });
  });
});
