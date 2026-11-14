import { STOREY, type Blueprint } from "../blueprint";
import { enclosedCells } from "../grid";

/**
 * Where it's dry. Rain falls on the lot from above, so each cell has a *cover height*: the height of whatever is over
 * it (a roof, an upper floor, or the ceiling of a room shut in by walls even if no roof has been painted), or 0 for
 * open sky. Rain stops at that height, and it counts the same however the roof is being drawn: hiding the roof in
 * cutaway mode changes what you see, not where it rains.
 */

/** A roof sits just above the walls of its floor. */
const ROOF_TOP = 0.3;
/** How far past the lot the map reaches (nothing is covered out there). */
export const SHELTER_MARGIN = 2;

export interface ShelterMap {
  /** Cells wide and deep, including the margin, and the lot cell at the corner of the map. */
  cols: number;
  rows: number;
  ox: number;
  oz: number;
  /** Cover height in metres for every cell, row by row (x fastest). */
  height: Float32Array;
}

export function shelterMap(bp: Blueprint): ShelterMap {
  const { w, d } = bp.lot;
  const cols = w + 2 * SHELTER_MARGIN;
  const rows = d + 2 * SHELTER_MARGIN;
  const height = new Float32Array(cols * rows);
  const put = (x: number, z: number, h: number) => {
    const i = (z + SHELTER_MARGIN) * cols + (x + SHELTER_MARGIN);
    if (h > height[i]!) height[i] = h;
  };
  bp.levels.forEach((level, i) => {
    // a room shut in by walls has a ceiling at the top of its storey, roof or no roof
    for (const key of enclosedCells(level.walls, w, d)) {
      const [x, z] = key.split(":").map(Number) as [number, number];
      put(x, z, (i + 1) * STOREY);
    }
    for (const key of Object.keys(level.roofs)) {
      const [x, z] = key.split(":").map(Number) as [number, number];
      put(x, z, (i + 1) * STOREY + ROOF_TOP);
    }
    // an upper floor is a ceiling for whatever is beneath it
    if (i > 0)
      for (const key of Object.keys(level.tiles)) {
        const [x, z] = key.split(":").map(Number) as [number, number];
        put(x, z, i * STOREY);
      }
  });
  return { cols, rows, ox: -SHELTER_MARGIN, oz: -SHELTER_MARGIN, height };
}

/** The cover height over the point (x, z) in lot metres: 0 for open sky (and anywhere outside the lot). */
export function coverAt(map: ShelterMap, x: number, z: number): number {
  const cx = Math.floor(x) - map.ox;
  const cz = Math.floor(z) - map.oz;
  if (cx < 0 || cz < 0 || cx >= map.cols || cz >= map.rows) return 0;
  return map.height[cz * map.cols + cx]!;
}

/** Whether something at (x, y, z) is under cover: there's a ceiling or roof comfortably above it. */
export function underCover(map: ShelterMap, x: number, y: number, z: number): boolean {
  return coverAt(map, x, z) > y + 1;
}

