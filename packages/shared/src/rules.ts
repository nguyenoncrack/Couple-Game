import { emptyLevel, MAX_LEVELS, STARTING_FUNDS, type Blueprint, type Level, type PlacedObject, type PlacedOpening } from "./blueprint";
import { catalog as defaultCatalog, type Catalog, type FurnitureItem, type OpeningItem } from "./catalog";
import { cellInLot, cellKey, edgeInLot, interiorEdges, openingEdges, parseCell, parseEdge, rotatedSize, type Rot } from "./grid";
import type { LoggedOp, SingleOp } from "./ops";
import { brokenLifts, isLift, liftClearance, liftProblem } from "./lifts";
import { brokenStairs, isStairs, stairsClearance, stairsProblem } from "./stairs";

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
  | "unknown-roof"
  | "unknown-item"
  | "id-taken"
  | "not-found"
  | "overlaps"
  | "wall-in-the-way"
  | "blocks-furniture"
  | "needs-wall"
  | "needs-floor"
  | "furniture-on-it"
  | "too-many-levels"
  | "level-not-empty"
  | "needs-floor-above"
  | "needs-landing"
  | "blocks-stairs"
  | "lift-ground"
  | "lift-no-stop"
  | "blocks-lift"
  | "cant-afford";

/** Short, friendly explanations for the UI. */
export const REJECT_TEXT: Record<RejectReason | "held" | "rate-limited" | "invalid", string> = {
  "no-level": "That floor doesn't exist.",
  "out-of-lot": "That's outside the lot.",
  "bad-edge": "That isn't a wall spot.",
  "bad-cell": "That isn't a floor tile.",
  "unknown-style": "That wall style doesn't exist.",
  "unknown-material": "That floor doesn't exist.",
  "unknown-roof": "That roof doesn't exist.",
  "unknown-item": "That item isn't in the catalog.",
  "id-taken": "Something already uses that ID.",
  "not-found": "That's already gone.",
  overlaps: "Something's already there.",
  "wall-in-the-way": "A wall is in the way.",
  "blocks-furniture": "Furniture is in the way of that wall.",
  "needs-wall": "Doors and windows go in a wall.",
  "needs-floor": "Upstairs, things need floor under them. Lay some floor first.",
  "furniture-on-it": "Something's standing on that floor. Move it first.",
  "too-many-levels": "That's as tall as a house can go.",
  "level-not-empty": "Clear everything off this floor before taking it away.",
  "needs-floor-above": "Stairs go up to a floor above. Add one first with the + by the floor buttons.",
  "needs-landing": "There's no floor upstairs to step off onto at the top. Lay some there first.",
  "blocks-stairs": "That would block the stairs.",
  "lift-ground": "Lifts stand on the ground floor; the shaft goes up through every floor above.",
  "lift-no-stop": "The lift needs floor laid in front of its doors on a floor above, to stop at.",
  "blocks-lift": "That would block the lift.",
  "cant-afford": "Not enough coins for that yet. Dropping by each day earns more.",
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
  if (isLift(item) && level !== bp.levels[0]) return "lift-ground";
  // upstairs there's only floor where it's been laid
  if (level !== bp.levels[0]) for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) if (!level.tiles[cellKey(x, z)]) return "needs-floor";
  for (const e of interiorEdges(f.x, f.z, f.w, f.d)) if (level.walls[e]) return "wall-in-the-way";
  for (const other of Object.values(level.objects)) {
    if (other.id === ignoreId) continue;
    const oi = cat.furniture.get(other.catalogId);
    if (!oi || oi.layer !== item.layer) continue;
    const g = footprintOf(oi, other);
    if (f.x < g.x + g.w && g.x < f.x + f.w && f.z < g.z + g.d && g.z < f.z + f.d) return "overlaps";
  }
  const index = bp.levels.indexOf(level);
  if (index < 0) return null;
  // out of the way of stairs (rugs are fine), and stairs themselves need somewhere to go
  if (item.layer === "floor") {
    const keep = stairsClearance(bp, index, cat, ignoreId);
    for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) if (keep.has(cellKey(x, z))) return "blocks-stairs";
    const shaft = liftClearance(bp, index, cat, ignoreId);
    for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) if (shaft.has(cellKey(x, z))) return "blocks-lift";
  }
  if (isStairs(item)) return stairsProblem(bp, index, { id: ignoreId ?? "", ...at }, item, cat);
  if (isLift(item)) return liftProblem(bp, index, { id: ignoreId ?? "", ...at }, item, cat);
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

/** The house with one level changed, and `cost` coins spent on it (or given back, when it's negative). */
function withLevel(bp: Blueprint, index: number, level: Level, cost = 0): Blueprint {
  const levels = bp.levels.slice();
  levels[index] = level;
  return { ...bp, levels, funds: (bp.funds ?? STARTING_FUNDS) - cost };
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

/** Is there anything at all on this floor? */
const isEmpty = (l: Level) => [l.walls, l.tiles, l.objects, l.openings, l.roofs].every((r) => Object.keys(r).length === 0);

function applySingle(bp: Blueprint, op: SingleOp, cat: Catalog): ApplyResult {
  if (op.t === "level.add") {
    if (op.level >= MAX_LEVELS) return fail("too-many-levels");
    if (op.level !== bp.levels.length) return fail("no-level");
    return { ok: true, blueprint: { ...bp, levels: [...bp.levels, emptyLevel()] } };
  }
  const level = bp.levels[op.level];
  if (!level) return fail("no-level");
  if (op.t === "level.remove") {
    // only the top floor, never the ground, and only once it's bare
    if (op.level === 0 || op.level !== bp.levels.length - 1) return fail("no-level");
    if (!isEmpty(level)) return fail("level-not-empty");
    return { ok: true, blueprint: { ...bp, levels: bp.levels.slice(0, -1) } };
  }
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
      let refund = 0;
      for (const o of Object.values(level.openings)) {
        const item = cat.openings.get(o.catalogId);
        if (item && edgesOfOpening(item, o).some((e) => gone.has(e))) {
          if (openings === level.openings) openings = { ...openings };
          delete openings[o.id];
          refund += item.price;
        }
      }
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, walls, openings }, -refund) };
    }

    case "floor.paint": {
      if (op.material !== null && !cat.floorMaterials.has(op.material)) return fail("unknown-material");
      for (const key of op.cells) {
        const c = parseCell(key);
        if (!c) return fail("bad-cell");
        if (!cellInLot(c.x, c.z, w, d)) return fail("out-of-lot");
      }
      // upstairs, taking floor away from under furniture would leave it in the air
      if (op.material === null && op.level > 0) {
        const gone = new Set(op.cells);
        for (const o of Object.values(level.objects)) {
          const item = cat.furniture.get(o.catalogId);
          if (!item) continue;
          const f = footprintOf(item, o);
          for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) if (gone.has(cellKey(x, z))) return fail("furniture-on-it");
        }
      }
      const tiles = { ...level.tiles };
      for (const key of op.cells) {
        if (op.material === null) delete tiles[key];
        else tiles[key] = { material: op.material };
      }
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, tiles }) };
    }

    case "roof.paint": {
      if (op.style !== null && !cat.roofStyles.has(op.style)) return fail("unknown-roof");
      for (const key of op.cells) {
        const c = parseCell(key);
        if (!c) return fail("bad-cell");
        if (!cellInLot(c.x, c.z, w, d)) return fail("out-of-lot");
      }
      const roofs = { ...level.roofs };
      for (const key of op.cells) {
        if (op.style === null) delete roofs[key];
        else roofs[key] = { style: op.style };
      }
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, roofs }) };
    }

    case "object.place": {
      const item = cat.furniture.get(op.catalogId);
      if (!item) return fail("unknown-item");
      if (idTaken(bp, op.id)) return fail("id-taken");
      const problem = placementProblem(bp, level, item, op, null, cat);
      if (problem) return fail(problem);
      const placed: PlacedObject = { id: op.id, catalogId: op.catalogId, x: op.x, z: op.z, rot: op.rot };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, objects: { ...level.objects, [op.id]: placed } }, item.price) };
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
      const gone = level.objects[op.id];
      if (!gone) return fail("not-found");
      const objects = { ...level.objects };
      delete objects[op.id];
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, objects }, -(cat.furniture.get(gone.catalogId)?.price ?? 0)) };
    }

    case "opening.place": {
      const item = cat.openings.get(op.catalogId);
      if (!item) return fail("unknown-item");
      if (idTaken(bp, op.id)) return fail("id-taken");
      const problem = openingProblem(level, item, op, null, cat);
      if (problem) return fail(problem);
      const placed: PlacedOpening = { id: op.id, catalogId: op.catalogId, dir: op.dir, x: op.x, z: op.z, flip: op.flip };
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, openings: { ...level.openings, [op.id]: placed } }, item.price) };
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
      const gone = level.openings[op.id];
      if (!gone) return fail("not-found");
      const openings = { ...level.openings };
      delete openings[op.id];
      return { ok: true, blueprint: withLevel(bp, op.level, { ...level, openings }, -(cat.openings.get(gone.catalogId)?.price ?? 0)) };
    }
  }
}

/**
 * Apply an edit. Furniture, doors and windows cost their catalog price and give it back when they go (walls,
 * floors and roofs are free), and an edit that spends more than the house has is turned down. `accepted` is for
 * edits from the log, which the server already took: they always go through, even if a price changed since.
 */
export function applyOp(bp: Blueprint, op: LoggedOp, cat: Catalog = defaultCatalog, { accepted = false } = {}): ApplyResult {
  if (op.t === "funds.add") return { ok: true, blueprint: { ...bp, funds: (bp.funds ?? STARTING_FUNDS) + op.amount } };
  let cur = bp;
  if (op.t !== "batch") {
    const r = applySingle(bp, op, cat);
    if (!r.ok) return r;
    cur = r.blueprint;
  } else {
    // All or nothing: the first step that fails rejects the whole batch. Only the total cost matters, so a batch
    // can sell one thing to pay for the next.
    for (const step of op.ops) {
      const r = applySingle(cur, step, cat);
      if (!r.ok) return r;
      cur = r.blueprint;
    }
  }
  // nothing may leave stairs with nowhere to step on or off (checked once a batch is done, so a batch can lay the
  // landing and put the stairs in together)
  if (!accepted) {
    const broken = brokenStairs(bp, cur, cat) ?? brokenLifts(bp, cur, cat);
    if (broken) return fail(broken);
  }
  if (!accepted && cur.funds < 0 && cur.funds < (bp.funds ?? STARTING_FUNDS)) return fail("cant-afford");
  return { ok: true, blueprint: cur };
}

/** What an edit costs the house (negative if it gives coins back), or null if it can't be done at all. */
export function costOf(bp: Blueprint, op: LoggedOp, cat: Catalog = defaultCatalog): number | null {
  const r = applyOp(bp, op, cat, { accepted: true });
  return r.ok ? (bp.funds ?? STARTING_FUNDS) - r.blueprint.funds : null;
}
