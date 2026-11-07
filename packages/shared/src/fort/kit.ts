import type { Blueprint, Level, PlacedObject } from "../blueprint";
import { catalog as defaultCatalog, type Catalog, type FurnitureItem } from "../catalog";
import type { SingleOp } from "../ops";
import { anchorsAt, frameRect, sitsOn, type FramePlace, type PlacedAnchor } from "./anchors";
import type { FortRole, PieceRole } from "./definitions";

/** What a kit item is, if it is one. */
export const fortRole = (item: Pick<FurnitureItem, "fort"> | undefined): FortRole | null => item?.fort ?? null;

/** Every fort frame on a floor. */
export function framesOn(level: Level, cat: Catalog = defaultCatalog): PlacedObject[] {
  return Object.values(level.objects).filter((o) => cat.furniture.get(o.catalogId)?.fort === "frame");
}

/** Is there a fort frame with this ID anywhere in the house? */
export function findFrame(bp: Blueprint, id: string, cat: Catalog = defaultCatalog): { o: PlacedObject; level: number } | null {
  for (let i = 0; i < bp.levels.length; i++) {
    const o = bp.levels[i]!.objects[id];
    if (o && cat.furniture.get(o.catalogId)?.fort === "frame") return { o, level: i };
  }
  return null;
}

/** The snap points of a piece's kind that a piece at this spot would sit on, if any (on a frame on this floor). */
export function snapUnder(level: Level, role: PieceRole, at: PlacedObject | { x: number; z: number; rot: PlacedObject["rot"] }, cat: Catalog = defaultCatalog) {
  for (const frame of framesOn(level, cat)) {
    for (const p of anchorsAt(frame, role)) if (sitsOn(p, frame, at)) return { frame, anchor: p };
  }
  return null;
}

/** The pieces sitting on a frame's snap points, by snap point ID (the first of each, if there were somehow two). */
export function piecesOn(level: Level, frame: PlacedObject, cat: Catalog = defaultCatalog): Record<string, PlacedObject> {
  const out: Record<string, PlacedObject> = {};
  for (const o of Object.values(level.objects)) {
    const role = cat.furniture.get(o.catalogId)?.fort;
    if (!role || role === "frame") continue;
    for (const p of anchorsAt(frame, role)) if (sitsOn(p, frame, o) && !out[p.anchor.id]) out[p.anchor.id] = o;
  }
  return out;
}

/** Has the fort got fairy lights hung on it? */
export const hasFairyLights = (level: Level, frame: PlacedObject, cat: Catalog = defaultCatalog) => Boolean(piecesOn(level, frame, cat).lights);

/**
 * After an edit (checked once a whole batch is done, so a batch can move a fort and its pieces together, and undo
 * can put them back in either order): did a kit piece end up anywhere but on a fort's snap point? Only pieces the
 * edit placed or moved count; one left behind by a fort that's gone stays where it is.
 */
export function strayFortPiece(before: Blueprint, after: Blueprint, cat: Catalog = defaultCatalog): boolean {
  for (let i = 0; i < after.levels.length; i++) {
    const level = after.levels[i]!;
    for (const o of Object.values(level.objects)) {
      const role = cat.furniture.get(o.catalogId)?.fort;
      if (!role || role === "frame" || before.levels[i]?.objects[o.id] === o) continue;
      if (!snapUnder(level, role, o, cat)) return true;
    }
  }
  return false;
}

const sq = (n: number) => n * n;

/**
 * Where a piece being placed near a fort would snap: the closest free snap point of its kind, within a couple of
 * cells of the frame, as the spot to put it (null if there's none, so the caller can show it can't go).
 */
export function snapPiece(level: Level, item: FurnitureItem, near: { x: number; z: number }, cat: Catalog = defaultCatalog, ignoreId: string | null = null): { x: number; z: number; rot: PlacedObject["rot"] } | null {
  const role = item.fort;
  if (!role || role === "frame") return null;
  let best: { x: number; z: number; rot: PlacedObject["rot"]; score: number } | null = null;
  for (const frame of framesOn(level, cat)) {
    const taken = piecesOn(level, frame, cat);
    for (const p of anchorsAt(frame, role)) {
      const held = taken[p.anchor.id];
      if (held && held.id !== ignoreId) continue;
      const score = sq(p.x + p.w / 2 - near.x) + sq(p.z + p.d / 2 - near.z);
      if (score > 9 + sq(Math.max(p.w, p.d))) continue;
      if (!best || score < best.score) best = { x: p.x, z: p.z, rot: p.anchor.turns ? frame.rot : (near as { rot?: PlacedObject["rot"] }).rot ?? 0, score };
    }
  }
  return best && { x: best.x, z: best.z, rot: best.rot };
}

/**
 * Moving or turning a fort takes its pieces with it. The ops to do that: the frame first, then each piece on it
 * to where it belongs on the frame's new spot (a batch, so it all happens or none of it does).
 */
export function fortMoveOps(bp: Blueprint, levelIndex: number, frameId: string, to: FramePlace, cat: Catalog = defaultCatalog): SingleOp[] {
  const level = bp.levels[levelIndex];
  const frame = level?.objects[frameId];
  if (!level || !frame) return [];
  const ops: SingleOp[] = [{ t: "object.move", level: levelIndex, id: frameId, x: to.x, z: to.z, rot: to.rot }];
  const mine = piecesOn(level, frame, cat);
  const next = { ...frame, ...to };
  for (const p of anchorsAt(next)) {
    const piece = mine[p.anchor.id];
    if (!piece) continue;
    const rot = p.anchor.turns ? to.rot : (((piece.rot + to.rot - frame.rot + 4) % 4) as PlacedObject["rot"]);
    ops.push({ t: "object.move", level: levelIndex, id: piece.id, x: p.x, z: p.z, rot });
  }
  return ops;
}

export { frameRect };
