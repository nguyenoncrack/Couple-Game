import type { Level, PlacedObject } from "../blueprint";
import { catalog as defaultCatalog, type Action, type Catalog, type FurnitureItem, type Interaction, type InteractionSlot, type Station } from "../catalog";
import { cellKey, type Rot } from "../grid";
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

/** The lot cells of an item's footprint that are left clear to walk on (see `walkable` in the catalog), as keys. */
export function walkableCells(item: Pick<FurnitureItem, "footprint" | "walkable">, o: Pick<PlacedObject, "x" | "z" | "rot">): Set<string> {
  const out = new Set<string>();
  for (const [cx, cz] of item.walkable ?? []) {
    const [x, z] = toWorld(item, o, cx + 0.5, cz + 0.5);
    out.add(cellKey(Math.floor(x), Math.floor(z)));
  }
  return out;
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
  /** Over after this long, for quick things. */
  seconds?: number;
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
    seconds: it.seconds,
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

/** Every slot for this action in the house. */
export function slotsFor(level: Level, action: Action, cat: Catalog = defaultCatalog): PlacedSlot[] {
  return Object.values(level.objects).flatMap((o) => slotsOf(o, action, cat));
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

/** The middle of a TV's screen and the way it faces, if this object is one (something you can watch). */
export function screenOf(o: PlacedObject, cat: Catalog = defaultCatalog): { x: number; z: number; face: Rot } | null {
  const item = cat.furniture.get(o.catalogId);
  if (!item?.interactions?.some((i) => i.action === "watch")) return null;
  const [x, z] = toWorld(item, o, item.footprint[0] / 2, 0.3);
  return { x, z, face: o.rot };
}

/** Can you see a screen from a seat: in front of it, facing it, not too close or far? */
function inView(seat: PlacedSlot["pose"], screen: { x: number; z: number; face: Rot }) {
  const vx = screen.x - seat.x;
  const vz = screen.z - seat.z;
  const dist = Math.hypot(vx, vz);
  if (dist < 1.2 || dist > 7) return false;
  const [sx, sz] = faceDir(seat.face);
  const [tx, tz] = faceDir(screen.face);
  return (sx * vx + sz * vz) / dist > 0.5 && -(tx * vx + tz * vz) / dist > 0.5;
}

/** The TV a seat looks at, if any (the nearest, if there are a few). */
export function tvFacing(level: Level, seat: PlacedSlot, cat: Catalog = defaultCatalog): PlacedObject | null {
  let best: { o: PlacedObject; dist: number } | null = null;
  for (const o of Object.values(level.objects)) {
    const screen = screenOf(o, cat);
    if (!screen || !inView(seat.pose, screen)) continue;
    const dist = Math.hypot(screen.x - seat.pose.x, screen.z - seat.pose.z);
    if (!best || dist < best.dist) best = { o, dist };
  }
  return best?.o ?? null;
}

/** Is this TV in view from a seat? */
export function canSee(seat: PlacedSlot, tv: PlacedObject, cat: Catalog = defaultCatalog) {
  const screen = screenOf(tv, cat);
  return Boolean(screen && inView(seat.pose, screen));
}

/** Seats in the house with a view of this TV. */
export function seatsFacing(level: Level, tv: PlacedObject, cat: Catalog = defaultCatalog): PlacedSlot[] {
  const screen = screenOf(tv, cat);
  return screen ? slotsFor(level, "sit", cat).filter((s) => inView(s.pose, screen)) : [];
}
