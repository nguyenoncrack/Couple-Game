import type { Blueprint, PlacedObject } from "../blueprint";
import { catalog as defaultCatalog, type Catalog } from "../catalog";
import { edgeKey, openingEdges, type EdgeKey, type Rot } from "../grid";
import { footprintOf } from "../rules";
import { rainAt } from "../world/weather";
import type { WorldState } from "../world/definitions";
import { slotsOf } from "./interactions";

/**
 * Watching the rain: sitting on a window bench (a seat whose sitters face the wall behind it, with a window in that
 * wall) while it's raining. Two people on the two seats of one bench while it rains are watching it *together*, which
 * does their Social need some good (see `GAIN.rain` in needs.ts). Standing up is always allowed, and the rain stopping
 * only ends the bonus, not the sitting.
 */

/** Rain at least this heavy counts (a few drops don't). */
export const WATCH_RAIN = 0.15;

export const isRainWatchable = (now: number, world?: Pick<WorldState, "weather"> | null) => rainAt(now, world) >= WATCH_RAIN;

/** The direction a seat faces, as a step on the lot (the quarter turns of `Rot`: 0 faces +z, 1 -x, 2 -z, 3 +x). */
export const faceStep = (face: Rot): [number, number] => (face === 0 ? [0, 1] : face === 1 ? [-1, 0] : face === 2 ? [0, -1] : [1, 0]);

/** The wall edges along the side of an object's footprint that its first seat faces. */
function edgesFaced(o: PlacedObject, face: Rot, cat: Catalog): EdgeKey[] {
  const item = cat.furniture.get(o.catalogId);
  if (!item) return [];
  const f = footprintOf(item, o);
  const out: EdgeKey[] = [];
  const [dx, dz] = faceStep(face);
  if (dz) for (let x = f.x; x < f.x + f.w; x++) out.push(edgeKey("h", x, dz < 0 ? f.z : f.z + f.d));
  else for (let z = f.z; z < f.z + f.d; z++) out.push(edgeKey("v", dx < 0 ? f.x : f.x + f.w, z));
  return out;
}

/**
 * Is there a window in the wall the seat faces (on the floor `level`)? Any window counts, frosted ones too: you can
 * still watch the rain run down the glass.
 */
export function windowBehind(bp: Blueprint, level: number, o: PlacedObject, cat: Catalog = defaultCatalog): boolean {
  const l = bp.levels[level];
  const seat = slotsOf(o, "sit", cat)[0];
  if (!l || !seat) return false;
  const faced = new Set(edgesFaced(o, seat.pose.face, cat));
  for (const op of Object.values(l.openings)) {
    if (cat.openings.get(op.catalogId)?.kind !== "window") continue;
    const width = cat.openings.get(op.catalogId)!.width;
    if (openingEdges(op.dir, op.x, op.z, width).some((e) => faced.has(e))) return true;
  }
  return false;
}

const memo = new WeakMap<Blueprint, Set<string>>();

/** The ids of every window bench in the house that has a window behind it (remembered per house version). */
export function windowSeats(bp: Blueprint, cat: Catalog = defaultCatalog): Set<string> {
  const hit = memo.get(bp);
  if (hit && cat === defaultCatalog) return hit;
  const out = new Set<string>();
  bp.levels.forEach((level, i) => {
    for (const o of Object.values(level.objects)) if (cat.furniture.get(o.catalogId)?.windowSeat && windowBehind(bp, i, o, cat)) out.add(o.id);
  });
  if (cat === defaultCatalog) memo.set(bp, out);
  return out;
}
