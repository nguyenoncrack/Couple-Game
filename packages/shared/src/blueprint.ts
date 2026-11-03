import type { CellKey, EdgeKey, Rot } from "./grid";

/**
 * A house is a blueprint: plain JSON that the server owns and both players edit through ops.
 * Everything in it is keyed by a stable ID, so an edit names exactly what it touches.
 */

export const BLUEPRINT_SCHEMA = 1;

export interface WallEdge {
  /** A wall style ID from the catalog. */
  style: string;
}

export interface Tile {
  /** A floor material ID from the catalog. */
  material: string;
}

export interface PlacedObject {
  id: string;
  catalogId: string;
  /** The footprint's lowest cell after rotation. */
  x: number;
  z: number;
  rot: Rot;
}

export interface Level {
  walls: Record<EdgeKey, WallEdge>;
  tiles: Record<CellKey, Tile>;
  objects: Record<string, PlacedObject>;
}

export interface Blueprint {
  schema: typeof BLUEPRINT_SCHEMA;
  /** Lot size in cells. */
  lot: { w: number; d: number };
  /** Index 0 is the ground floor. Only one floor for now. */
  levels: Level[];
}

export const emptyLevel = (): Level => ({ walls: {}, tiles: {}, objects: {} });

export function emptyBlueprint(w = 24, d = 20): Blueprint {
  return { schema: BLUEPRINT_SCHEMA, lot: { w, d }, levels: [emptyLevel()] };
}

/** A blueprint and the number of edits that produced it. */
export interface HouseState {
  version: number;
  blueprint: Blueprint;
}
