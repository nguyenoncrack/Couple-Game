import type { Blueprint, Level, PlacedObject } from "./blueprint";
import type { Catalog, FurnitureItem } from "./catalog";
import { cellKey, interiorEdges, rotatedSize, type Rot } from "./grid";
import type { Cell } from "./life/nav";
import { edgeBetween } from "./stairs";

/**
 * A lift stands on the ground floor and its shaft goes up through every floor above, so the shafts always line up
 * (the shaft upstairs isn't stored: it's wherever a lift below is). Its doors open on the side it faces, and a floor
 * is one of its stops when there's floor to step out onto there.
 */

/** The way the doors face (x, z), as a model turned by it faces. */
const FACE: Record<Rot, Cell> = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };

export interface Shaft {
  /** Every cell the shaft stands on. */
  cells: Cell[];
  /** Out through the doors. */
  face: Cell;
  /** The cells just outside the doors, where you wait and step out. */
  front: Cell[];
  /** The edges the doors are in. */
  doors: string[];
  /** The middle of the car (lot metres). */
  centre: [number, number];
  /** Where passengers stand inside, side by side (lot metres). */
  spots: [number, number][];
}

export const isLift = (item: FurnitureItem | undefined): item is FurnitureItem => Boolean(item?.lift);

/** The shaft of a lift placed like this. */
export function shaftOf(item: Pick<FurnitureItem, "footprint">, o: { x: number; z: number; rot: Rot }): Shaft {
  const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
  const face = FACE[o.rot];
  const cells: Cell[] = [];
  for (let x = o.x; x < o.x + w; x++) for (let z = o.z; z < o.z + d; z++) cells.push([x, z]);
  // the row of cells on the door side, and the ones just past it
  const edge = cells.filter(([x, z]) => (face[0] > 0 ? x === o.x + w - 1 : face[0] < 0 ? x === o.x : face[1] > 0 ? z === o.z + d - 1 : z === o.z));
  const front = edge.map(([x, z]): Cell => [x + face[0], z + face[1]]);
  const centre: [number, number] = [o.x + w / 2, o.z + d / 2];
  const spots: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) spots.push([o.x + 0.5 + i + (i - (w - 1) / 2) * -0.1, o.z + 0.5 + j + (j - (d - 1) / 2) * -0.1]);
  // filled from the doors back, side by side, so people get on and off through a door each
  const ahead = ([x, z]: [number, number]) => (x - centre[0]) * face[0] + (z - centre[1]) * face[1];
  const across = ([x, z]: [number, number]) => (x - centre[0]) * face[1] - (z - centre[1]) * face[0];
  spots.sort((p, q) => ahead(q) - ahead(p) || across(p) - across(q));
  return { cells, face, front, doors: edge.map((c, i) => edgeBetween(c, front[i]!)), centre, spots };
}

/** Every lift in the house (they all stand on the ground floor), with its shaft. */
export function liftsIn(bp: Blueprint, cat: Catalog): { o: PlacedObject; item: FurnitureItem; shaft: Shaft }[] {
  const out = [];
  for (const o of Object.values(bp.levels[0]?.objects ?? {})) {
    const item = cat.furniture.get(o.catalogId);
    if (isLift(item)) out.push({ o, item, shaft: shaftOf(item, o) });
  }
  return out;
}

/** The cells of lift shafts going up through a floor above the ground. */
export function liftShafts(bp: Blueprint, index: number, cat: Catalog): Set<string> {
  const out = new Set<string>();
  if (index > 0) for (const { shaft } of liftsIn(bp, cat)) for (const [x, z] of shaft.cells) out.add(cellKey(x, z));
  return out;
}

/** Cells on floor `index` that have to stay clear for lifts (other than `ignore`): the shaft upstairs, and the way in. */
export function liftClearance(bp: Blueprint, index: number, cat: Catalog, ignore: string | null = null): Set<string> {
  const keep = new Set<string>();
  for (const { o, shaft } of liftsIn(bp, cat)) {
    if (o.id === ignore) continue;
    for (const [x, z] of shaft.front) keep.add(cellKey(x, z));
    if (index > 0) for (const [x, z] of shaft.cells) keep.add(cellKey(x, z));
  }
  return keep;
}

export type LiftProblem = "lift-ground" | "needs-floor-above" | "lift-no-stop" | "blocks-lift" | "out-of-lot";

/** Floor-standing furniture's cells on a floor (other than `ignore`). */
function standing(level: Level, cat: Catalog, ignore: string | null) {
  const at = new Set<string>();
  for (const o of Object.values(level.objects)) {
    if (o.id === ignore) continue;
    const item = cat.furniture.get(o.catalogId);
    if (!item || item.layer !== "floor") continue;
    const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
    for (let x = o.x; x < o.x + w; x++) for (let z = o.z; z < o.z + d; z++) at.add(cellKey(x, z));
  }
  return at;
}

/**
 * Why a lift can't be here (on floor `index`), or null if it can: on the ground floor, with a floor above that has
 * floor laid at its doors, and nothing in the shaft or in front of the doors on any floor.
 */
export function liftProblem(bp: Blueprint, index: number, o: Pick<PlacedObject, "id" | "x" | "z" | "rot">, item: FurnitureItem, cat: Catalog): LiftProblem | null {
  if (index !== 0) return "lift-ground";
  if (bp.levels.length < 2) return "needs-floor-above";
  const shaft = shaftOf(item, o);
  const { w, d } = bp.lot;
  if (shaft.front.some(([x, z]) => x < 0 || z < 0 || x >= w || z >= d)) return "out-of-lot";
  const [fw, fd] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
  let stops = 0;
  for (let i = 0; i < bp.levels.length; i++) {
    const level = bp.levels[i]!;
    const taken = standing(level, cat, o.id);
    if (shaft.front.some(([x, z]) => taken.has(cellKey(x, z))) || shaft.doors.some((e) => level.walls[e])) return "blocks-lift";
    if (i === 0) continue;
    if (shaft.cells.some(([x, z]) => taken.has(cellKey(x, z)))) return "blocks-lift";
    if (interiorEdges(o.x, o.z, fw, fd).some((e) => level.walls[e])) return "blocks-lift";
    if (shaft.front.some(([x, z]) => level.tiles[cellKey(x, z)])) stops++;
  }
  return stops ? null : "lift-no-stop";
}

/** After an edit: the first lift it broke, and why (as with stairs, one already out of order doesn't count). */
export function brokenLifts(before: Blueprint, after: Blueprint, cat: Catalog): LiftProblem | null {
  for (const { o, item } of liftsIn(after, cat)) {
    const problem = liftProblem(after, 0, o, item, cat);
    if (!problem) continue;
    const was = before.levels[0]?.objects[o.id];
    const same = was && was.x === o.x && was.z === o.z && was.rot === o.rot;
    if (!same) return problem;
    if (!liftProblem(before, 0, was, item, cat)) return problem === "lift-no-stop" ? problem : "blocks-lift";
  }
  return null;
}
