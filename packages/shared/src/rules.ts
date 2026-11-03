import type { Blueprint, Level, PlacedObject, PlacedOpening } from "./blueprint";
import { catalog as defaultCatalog, type Catalog, type FurnitureItem, type OpeningItem } from "./catalog";
import { cellInLot, edgeInLot, interiorEdges, openingEdges, parseCell, parseEdge, rotatedSize, type Rot } from "./grid";
import type { Op, SingleOp } from "./ops";

/**
 * The game's building rules. `applyOp` is pure: the server runs it to decide what happens, and the client runs the
 * same function to show an edit instantly before the server confirms it. It never mutates its input; unchanged
 * parts of the blueprint are shared with the result.
 */

export type ApplyResult = { ok: true; blueprint: Blueprint } | { ok: false; reason: RejectReason };

export type RejectReason =
  | "no-level"
  | "out-of-lot"
  | "bad-edge"
  | "bad-cell"
  | "unknown-style"
  | "unknown-material"
  | "unknown-item"
  | "id-taken"
  | "not-found"
  | "overlaps"
  | "wall-in-the-way"
  | "blocks-furniture"
  | "needs-wall";

/** Short, friendly explanations for the UI. */
export const REJECT_TEXT: Record<RejectReason | "held" | "rate-limited" | "invalid", string> = {
  "no-level": "That floor doesn't exist.",
  "out-of-lot": "That's outside the lot.",
  "bad-edge": "That isn't a wall spot.",
  "bad-cell": "That isn't a floor tile.",
  "unknown-style": "That wall style doesn't exist.",
  "unknown-material": "That floor doesn't exist.",
  "unknown-item": "That item isn't in the catalog.",
  "id-taken": "Something already uses that ID.",
  "not-found": "That's already gone.",
  overlaps: "Something's already there.",
  "wall-in-the-way": "A wall is in the way.",
  "blocks-furniture": "Furniture is in the way of that wall.",
  "needs-wall": "Doors and windows go in a wall.",
  held: "Your partner is moving that right now.",
  "rate-limited": "Slow down a little.",
  invalid: "That edit didn't make sense.",
};

const fail = (reason: RejectReason): ApplyResult => ({ ok: false, reason });

export function footprintOf(item: Pick<FurnitureItem, "footprint">, o: { x: number; z: number; rot: Rot }) {
  const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
  return { x: o.x, z: o.z, w, d };
}

/** Why an item can't stand at this spot, or null if it can. `ignoreId` skips the object being moved. */
export function placementProblem(
  bp: Blueprint,
  level: Level,
  item: FurnitureItem,
  at: { x: number; z: number; rot: Rot },
  ignoreId: string | null,
  cat: Catalog = defaultCatalog,
): RejectReason | null {
  const f = footprintOf(item, at);
  if (f.x < 0 || f.z < 0 || f.x + f.w > bp.lot.w || f.z + f.d > bp.lot.d) return "out-of-lot";
  for (const e of interiorEdges(f.x, f.z, f.w, f.d)) if (level.walls[e]) return "wall-in-the-way";
  for (const other of Object.values(level.objects)) {
    if (other.id === ignoreId) continue;
    const oi = cat.furniture.get(other.catalogId);
    if (!oi || oi.layer !== item.layer) continue;
    const g = footprintOf(oi, other);
    if (f.x < g.x + g.w && g.x < f.x + f.w && f.z < g.z + g.d && g.z < f.z + f.d) return "overlaps";
  }
  return null;
}

/** IDs of objects that a wall on this edge would cut through. */
function objectsCutBy(level: Level, edges: Set<string>, cat: Catalog): string[] {
  const hit: string[] = [];
  for (const o of Object.values(level.objects)) {
    const item = cat.furniture.get(o.catalogId);
    if (!item) continue;
    const f = footprintOf(item, o);
    if (interiorEdges(f.x, f.z, f.w, f.d).some((e) => edges.has(e))) hit.push(o.id);
  }
  return hit;
}

function withLevel(bp: Blueprint, index: number, level: Level): Blueprint {
  const levels = bp.levels.slice();
  levels[index] = level;
  return { ...bp, levels };
}

/** The wall edges a placed door or window covers. */
export function edgesOfOpening(item: OpeningItem, o: Pick<PlacedOpening, "dir" | "x" | "z">) {
  return openingEdges(o.dir, o.x, o.z, item.width);
}

/** Why a door or window can't go here, or null if it can. `ignoreId` skips the one being moved. */
export function openingProblem(level: Level, item: OpeningItem, at: Pick<PlacedOpening, "dir" | "x" | "z">, ignoreId: string | null, cat: Catalog = defaultCatalog): RejectReason | null {
  const edges = edgesOfOpening(item, at);
  if (edges.some((e) => !level.walls[e])) return "needs-wall";
  const mine = new Set(edges);
  for (const other of Object.values(level.openings)) {
    if (other.id === ignoreId) continue;
    const oi = cat.openings.get(other.catalogId);
    if (oi && edgesOfOpening(oi, other).some((e) => mine.has(e))) return "overlaps";
  }
  return null;
}

const idTaken = (bp: Blueprint, id: string) => bp.levels.some((l) => l.objects[id] || l.openings[id]);

function applySingle(bp: Blueprint, op: SingleOp, cat: Catalog): ApplyResult {
  const level = bp.levels[op.level];
  if (!level) return fail("no-level");
  const { w, d } = bp.lot;

  switch (op.t) {
    case "walls.add": {
      if (!cat.wallStyles.has(op.style)) return fail("unknown-style");
      for (const key of op.edges) {
        const e = parseEdge(key);
        if (!e) return fail("bad-edge");
        if (!edgeInLot(e, w, d)) return fail("out-of-lot");
      }
      if (objectsCutBy(level, new Set(op.edges), cat).length) return fail("blocks-furniture");
      const walls = { ...level.walls };
      for (const key of op.edges) walls[key] = { style: op.style };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, walls }) };
    }

    case "walls.remove": {
      for (const key of op.edges) if (!parseEdge(key)) return fail("bad-edge");
      const gone = new Set(op.edges);
      const walls = { ...level.walls };
      for (const key of op.edges) delete walls[key];
      // Doors and windows in a removed wall go with it.
      let openings = level.openings;
      for (const o of Object.values(level.openings)) {
        const item = cat.openings.get(o.catalogId);
        if (item && edgesOfOpening(item, o).some((e) => gone.has(e))) {
          if (openings === level.openings) openings = { ...openings };
          delete openings[o.id];
        }
      }
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, walls, openings }) };
    }

    case "floor.paint": {
      if (op.material !== null && !cat.floorMaterials.has(op.material)) return fail("unknown-material");
      for (const key of op.cells) {
        const c = parseCell(key);
        if (!c) return fail("bad-cell");
        if (!cellInLot(c.x, c.z, w, d)) return fail("out-of-lot");
      }
      const tiles = { ...level.tiles };
      for (const key of op.cells) {
        if (op.material === null) delete tiles[key];
        else tiles[key] = { material: op.material };
      }
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, tiles }) };
    }

    case "object.place": {
      const item = cat.furniture.get(op.catalogId);
      if (!item) return fail("unknown-item");
      if (idTaken(bp, op.id)) return fail("id-taken");
      const problem = placementProblem(bp, level, item, op, null, cat);
      if (problem) return fail(problem);
      const placed: PlacedObject = { id: op.id, catalogId: op.catalogId, x: op.x, z: op.z, rot: op.rot };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, objects: { ...level.objects, [op.id]: placed } }) };
    }

    case "object.move": {
      const current = level.objects[op.id];
      if (!current) return fail("not-found");
      const item = cat.furniture.get(current.catalogId);
      if (!item) return fail("unknown-item");
      const problem = placementProblem(bp, level, item, op, op.id, cat);
      if (problem) return fail(problem);
      const moved: PlacedObject = { ...current, x: op.x, z: op.z, rot: op.rot };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, objects: { ...level.objects, [op.id]: moved } }) };
    }

    case "object.remove": {
      if (!level.objects[op.id]) return fail("not-found");
      const objects = { ...level.objects };
      delete objects[op.id];
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, objects }) };
    }

    case "opening.place": {
      const item = cat.openings.get(op.catalogId);
      if (!item) return fail("unknown-item");
      if (idTaken(bp, op.id)) return fail("id-taken");
      const problem = openingProblem(level, item, op, null, cat);
      if (problem) return fail(problem);
      const placed: PlacedOpening = { id: op.id, catalogId: op.catalogId, dir: op.dir, x: op.x, z: op.z, flip: op.flip };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, openings: { ...level.openings, [op.id]: placed } }) };
    }

    case "opening.move": {
      const current = level.openings[op.id];
      if (!current) return fail("not-found");
      const item = cat.openings.get(current.catalogId);
      if (!item) return fail("unknown-item");
      const problem = openingProblem(level, item, op, op.id, cat);
      if (problem) return fail(problem);
      const moved: PlacedOpening = { ...current, dir: op.dir, x: op.x, z: op.z, flip: op.flip };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, openings: { ...level.openings, [op.id]: moved } }) };
    }

    case "opening.remove": {
      if (!level.openings[op.id]) return fail("not-found");
      const openings = { ...level.openings };
      delete openings[op.id];
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, openings }) };
    }
  }
}

export function applyOp(bp: Blueprint, op: Op, cat: Catalog = defaultCatalog): ApplyResult {
  if (op.t !== "batch") return applySingle(bp, op, cat);
  // All or nothing: the first step that fails rejects the whole batch.
  let cur = bp;
  for (const step of op.ops) {
    const r = applySingle(cur, step, cat);
    if (!r.ok) return r;
    cur = r.blueprint;
  }
  return { ok: true, blueprint: cur };
}
