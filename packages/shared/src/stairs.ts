import type { Blueprint, Level, PlacedObject } from "./blueprint";
import type { Catalog, FurnitureItem } from "./catalog";
import { cellKey, edgeKey, interiorEdges, rotatedSize, type Rot } from "./grid";
import type { Cell } from "./life/nav";

/**
 * Stairs climb one storey along their length, towards the way they face: you step on at the low end from the floor
 * they stand on, and off at the top onto the floor above. The floor above gets a hole over them (it isn't stored:
 * it's wherever stairs below are), and nothing up there can stand in it. Wide stairs are side-by-side lanes.
 */

/** The way each facing climbs (x, z), as a model turned by it faces. */
const CLIMB: Record<Rot, Cell> = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };

export interface Lane {
  /** The stairs' own cells, bottom step first. */
  cells: Cell[];
  /** Where you stand to step on, on the floor the stairs stand on. */
  entry: Cell;
  /** Where you step off, on the floor above. */
  exit: Cell;
}

export interface Flight {
  climb: Cell;
  lanes: Lane[];
  /** Every cell they stand on. */
  cells: Cell[];
}

export const isStairs = (item: FurnitureItem | undefined): item is FurnitureItem => Boolean(item?.stairs);

/** The cells, entry and landing of stairs placed like this. */
export function flightOf(item: Pick<FurnitureItem, "footprint">, o: { x: number; z: number; rot: Rot }): Flight {
  const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
  const climb = CLIMB[o.rot];
  const alongZ = climb[0] === 0;
  const lanes: Lane[] = [];
  const across = alongZ ? w : d;
  const length = alongZ ? d : w;
  for (let i = 0; i < across; i++) {
    const cells: Cell[] = [];
    for (let j = 0; j < length; j++) {
      const k = (alongZ ? climb[1] : climb[0]) > 0 ? j : length - 1 - j;
      cells.push(alongZ ? [o.x + i, o.z + k] : [o.x + k, o.z + i]);
    }
    const first = cells[0]!;
    const last = cells[cells.length - 1]!;
    lanes.push({ cells, entry: [first[0] - climb[0], first[1] - climb[1]], exit: [last[0] + climb[0], last[1] + climb[1]] });
  }
  return { climb, lanes, cells: lanes.flatMap((l) => l.cells) };
}

/** The wall edge between two side-by-side cells. */
export const edgeBetween = (a: Cell, b: Cell) => (a[0] !== b[0] ? edgeKey("v", Math.max(a[0], b[0]), a[1]) : edgeKey("h", a[0], Math.max(a[1], b[1])));

/** Every flight of stairs on a floor, with what it is. */
export function flightsOn(level: Level | undefined, cat: Catalog): { o: PlacedObject; item: FurnitureItem; flight: Flight }[] {
  if (!level) return [];
  const out = [];
  for (const o of Object.values(level.objects)) {
    const item = cat.furniture.get(o.catalogId);
    if (isStairs(item)) out.push({ o, item, flight: flightOf(item, o) });
  }
  return out;
}

/** The holes in a floor: the cells over stairs coming up from the floor below. */
export function stairHoles(bp: Blueprint, index: number, cat: Catalog): Set<string> {
  const holes = new Set<string>();
  if (index > 0) for (const { flight } of flightsOn(bp.levels[index - 1], cat)) for (const [x, z] of flight.cells) holes.add(cellKey(x, z));
  return holes;
}

/** The cells of floor-standing furniture on a floor (other than `ignore`), each to the object standing there. */
function standing(level: Level, cat: Catalog, ignore: string | null) {
  const at = new Map<string, string>();
  for (const o of Object.values(level.objects)) {
    if (o.id === ignore) continue;
    const item = cat.furniture.get(o.catalogId);
    if (!item || item.layer !== "floor") continue;
    const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
    for (let x = o.x; x < o.x + w; x++) for (let z = o.z; z < o.z + d; z++) at.set(cellKey(x, z), o.id);
  }
  return at;
}

/**
 * Cells on floor `index` that have to stay clear for stairs (other than `ignore`): where you step on to stairs on
 * this floor, and the stairwell and landing of stairs coming up from the one below.
 */
export function stairsClearance(bp: Blueprint, index: number, cat: Catalog, ignore: string | null = null): Set<string> {
  const keep = new Set<string>();
  for (const { o, flight } of flightsOn(bp.levels[index], cat)) if (o.id !== ignore) for (const l of flight.lanes) keep.add(cellKey(...l.entry));
  if (index > 0)
    for (const { o, flight } of flightsOn(bp.levels[index - 1], cat)) {
      if (o.id === ignore) continue;
      for (const [x, z] of flight.cells) keep.add(cellKey(x, z));
      for (const l of flight.lanes) keep.add(cellKey(...l.exit));
    }
  return keep;
}

export type StairsProblem = "needs-floor-above" | "needs-landing" | "blocks-stairs" | "out-of-lot" | "needs-floor";

/**
 * Why stairs can't be here (on floor `index`), or null if they can: there has to be a floor above with floor to step
 * out onto, room to step on at the bottom, and nothing up there in the stairwell or the way out.
 */
export function stairsProblem(bp: Blueprint, index: number, o: Pick<PlacedObject, "id" | "x" | "z" | "rot">, item: FurnitureItem, cat: Catalog): StairsProblem | null {
  const here = bp.levels[index];
  const up = bp.levels[index + 1];
  if (!here) return "needs-floor-above";
  if (!up) return "needs-floor-above";
  const { w, d } = bp.lot;
  const inLot = ([x, z]: Cell) => x >= 0 && z >= 0 && x < w && z < d;
  const flight = flightOf(item, o);
  const below = standing(here, cat, o.id);
  const above = standing(up, cat, null);
  for (const lane of flight.lanes) {
    if (!inLot(lane.entry) || !inLot(lane.exit)) return "out-of-lot";
    // stepping on: open floor, no wall across the bottom step
    if (index > 0 && !here.tiles[cellKey(...lane.entry)]) return "needs-floor";
    if (below.has(cellKey(...lane.entry)) || here.walls[edgeBetween(lane.entry, lane.cells[0]!)]) return "blocks-stairs";
    // stepping off: floor up there, nothing in the way, no wall across the top step
    if (!up.tiles[cellKey(...lane.exit)]) return "needs-landing";
    if (above.has(cellKey(...lane.exit)) || up.walls[edgeBetween(lane.cells[lane.cells.length - 1]!, lane.exit)]) return "blocks-stairs";
  }
  // the stairwell: nothing standing in it upstairs, no wall across it
  for (const [x, z] of flight.cells) if (above.has(cellKey(x, z))) return "blocks-stairs";
  const [fw, fd] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
  for (const e of interiorEdges(o.x, o.z, fw, fd)) if (up.walls[e]) return "blocks-stairs";
  return null;
}

/**
 * After an edit: the first stairs it broke, and why. Stairs that were already out of order (an old house) don't
 * count against it, unless the edit put them there.
 */
export function brokenStairs(before: Blueprint, after: Blueprint, cat: Catalog): StairsProblem | null {
  for (let i = 0; i < after.levels.length; i++) {
    for (const { o, item } of flightsOn(after.levels[i], cat)) {
      const problem = stairsProblem(after, i, o, item, cat);
      if (!problem) continue;
      const was = before.levels[i]?.objects[o.id];
      const same = was && was.x === o.x && was.z === o.z && was.rot === o.rot;
      if (!same) return problem;
      if (!stairsProblem(before, i, was, item, cat)) return "blocks-stairs";
    }
  }
  return null;
}
