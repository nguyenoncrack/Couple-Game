import type { CellKey, EdgeKey, Rot } from "./grid";

/**
 * A house is a blueprint: plain JSON that the server owns and both players edit through ops.
 * Everything in it is keyed by a stable ID, so an edit names exactly what it touches.
 */

export const BLUEPRINT_SCHEMA = 4;

/** Coins a house starts with (its furnishings come free): enough to make it your own. */
export const STARTING_FUNDS = 10_000;

export interface WallEdge {
  /** A wall style ID from the catalog. */
  style: string;
}

export interface Tile {
  /** A floor material ID from the catalog. */
  material: string;
}

/** A roof over one cell. Neighbouring roofed cells join into one roof that slopes up from its edges. */
export interface RoofCell {
  /** A roof style ID from the catalog. */
  style: string;
}

export interface PlacedObject {
  id: string;
  catalogId: string;
  /** The footprint's lowest cell after rotation. */
  x: number;
  z: number;
  rot: Rot;
}

/** A door or window in a wall: it covers `width` unit edges starting at edge (dir, x, z). */
export interface PlacedOpening {
  id: string;
  catalogId: string;
  dir: "h" | "v";
  x: number;
  z: number;
  /** Which side a door swings to / a window box sticks out on. */
  flip: boolean;
}

export interface Level {
  walls: Record<EdgeKey, WallEdge>;
  tiles: Record<CellKey, Tile>;
  objects: Record<string, PlacedObject>;
  openings: Record<string, PlacedOpening>;
  roofs: Record<CellKey, RoofCell>;
}

export interface Blueprint {
  schema: typeof BLUEPRINT_SCHEMA;
  /** Lot size in cells. */
  lot: { w: number; d: number };
  /** Index 0 is the ground floor. Only one floor for now. */
  levels: Level[];
  /** The household's coins: furniture, doors and windows cost their price and give it back when they go. */
  funds: number;
}

export const emptyLevel = (): Level => ({ walls: {}, tiles: {}, objects: {}, openings: {}, roofs: {} });

export function emptyBlueprint(w = 24, d = 20): Blueprint {
  return { schema: BLUEPRINT_SCHEMA, lot: { w, d }, levels: [emptyLevel()], funds: STARTING_FUNDS };
}

/**
 * Bring a saved blueprint up to the current schema. Old houses keep working as the game grows: each schema step
 * only adds what's missing.
 */
export function upgradeBlueprint(raw: Blueprint | (Omit<Blueprint, "schema" | "funds"> & { schema: number; funds?: number })): Blueprint {
  const bp = raw as Blueprint;
  if (bp.schema === BLUEPRINT_SCHEMA) return bp;
  // 1 → 2: doors and windows; 2 → 3: roofs; 3 → 4: coins (what's already there was free)
  return {
    ...bp,
    schema: BLUEPRINT_SCHEMA,
    levels: bp.levels.map((l) => ({ ...l, openings: l.openings ?? {}, roofs: l.roofs ?? {} })),
    funds: bp.funds ?? STARTING_FUNDS,
  };
}

/** A blueprint and the number of edits that produced it. */
export interface HouseState {
  version: number;
  blueprint: Blueprint;
}
