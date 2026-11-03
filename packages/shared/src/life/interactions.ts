import type { Level, PlacedObject } from "../blueprint";
import { catalog as defaultCatalog, type Action, type Catalog, type Interaction, type InteractionSlot, type Station } from "../catalog";
import type { Rot } from "../grid";
import { footprintOf } from "../rules";
import type { Cell } from "./nav";

/**
 * Turning an item's interaction slots (written in the item's own frame) into places on the lot, for wherever
 * and however the item has been placed.
 */

/** A point in the item's unrotated frame (metres from its footprint corner) to lot coordinates. */
export function toWorld(item: { footprint: [number, number] }, o: Pick<PlacedObject, "x" | "z" | "rot">, lx: number, lz: number): [number, number] {
  const [w, d] = item.footprint;
  const f = footprintOf(item, o);
  const vx = lx - w / 2;
  const vz = lz - d / 2;
  // the same turn the model gets: rotation.y = -rot · 90°
  const a = (-o.rot * Math.PI) / 2;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  return [f.x + f.w / 2 + vx * c + vz * s, f.z + f.d / 2 - vx * s + vz * c];
}

export interface PlacedSlot {
  objectId: string;
  action: Action;
  station?: Station;
  slot: number;
  /** Cells to stand on to use it, best first. */
  stand: Cell[];
  /** If none of those can be reached (a coffee table's in the way), any cell touching the spot itself. */
  around: Cell[];
  /** Where the character settles: lot coordinates in metres, height, and facing. */
  pose: { x: number; z: number; y: number; face: Rot };
}

function place(o: PlacedObject, item: { footprint: [number, number] }, it: Interaction, i: number, s: InteractionSlot): PlacedSlot {
  const [px, pz] = toWorld(item, o, s.pose[0], s.pose[1]);
  const cx = Math.floor(px);
  const cz = Math.floor(pz);
  const around: Cell[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) around.push([cx + dx, cz + dz]);
  return {
    objectId: o.id,
    action: it.action,
    station: it.station,
    slot: i,
    stand: s.stand.map(([cx, cz]) => {
      const [x, z] = toWorld(item, o, cx + 0.5, cz + 0.5);
      return [Math.floor(x), Math.floor(z)];
    }),
    around,
    pose: { x: px, z: pz, y: s.y, face: ((s.face + o.rot) % 4) as Rot },
  };
}

/** Every slot on one object for one action (or all of its slots). */
export function slotsOf(o: PlacedObject, action?: Action, cat: Catalog = defaultCatalog): PlacedSlot[] {
  const item = cat.furniture.get(o.catalogId);
  if (!item?.interactions) return [];
  const out: PlacedSlot[] = [];
  for (const it of item.interactions) {
    if (action && it.action !== action) continue;
    it.slots.forEach((s, i) => out.push(place(o, item, it, i, s)));
  }
  return out;
}

/** Every station of this kind in the house. */
export function stationSlots(level: Level, station: Station, cat: Catalog = defaultCatalog): PlacedSlot[] {
  const out: PlacedSlot[] = [];
  for (const o of Object.values(level.objects)) for (const s of slotsOf(o, undefined, cat)) if (s.station === station) out.push(s);
  return out;
}

/** The actions an object offers, in catalog order. */
export function actionsOf(o: PlacedObject, cat: Catalog = defaultCatalog): Action[] {
  return cat.furniture.get(o.catalogId)?.interactions?.map((i) => i.action) ?? [];
}

/** Unit direction a facing points along. */
export function faceDir(face: Rot): [number, number] {
  return [[0, 1] as [number, number], [-1, 0] as [number, number], [0, -1] as [number, number], [1, 0] as [number, number]][face]!;
}
