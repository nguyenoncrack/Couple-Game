/**
 * The building grid. One cell is one metre. Cell (x, z) covers world [x, x+1] × [z, z+1].
 *
 * Walls sit on the lines between cells, one unit edge at a time:
 *   "h:x:z"  runs from corner (x, z) to (x+1, z)   (along x)
 *   "v:x:z"  runs from corner (x, z) to (x, z+1)   (along z)
 * Unit edges make walls idempotent to add or remove, which keeps simultaneous edits simple.
 */

export type Rot = 0 | 1 | 2 | 3;
export type EdgeKey = string;
export type CellKey = string;

export interface Edge {
  dir: "h" | "v";
  x: number;
  z: number;
}

export const edgeKey = (dir: "h" | "v", x: number, z: number): EdgeKey => `${dir}:${x}:${z}`;
export const cellKey = (x: number, z: number): CellKey => `${x}:${z}`;

const EDGE_RE = /^([hv]):(-?\d{1,4}):(-?\d{1,4})$/;
const CELL_RE = /^(-?\d{1,4}):(-?\d{1,4})$/;

export function parseEdge(key: string): Edge | null {
  const m = EDGE_RE.exec(key);
  if (!m) return null;
  return { dir: m[1] as "h" | "v", x: Number(m[2]), z: Number(m[3]) };
}

export function parseCell(key: string): { x: number; z: number } | null {
  const m = CELL_RE.exec(key);
  if (!m) return null;
  return { x: Number(m[1]), z: Number(m[2]) };
}

/** Unit edges along a straight, axis-aligned line between two grid corners (empty if diagonal or zero length). */
export function edgesBetween(x1: number, z1: number, x2: number, z2: number): EdgeKey[] {
  const out: EdgeKey[] = [];
  if (z1 === z2 && x1 !== x2) {
    for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x++) out.push(edgeKey("h", x, z1));
  } else if (x1 === x2 && z1 !== z2) {
    for (let z = Math.min(z1, z2); z < Math.max(z1, z2); z++) out.push(edgeKey("v", x1, z));
  }
  return out;
}

/** Cells in the rectangle spanned by two cells (inclusive). */
export function cellsBetween(x1: number, z1: number, x2: number, z2: number): CellKey[] {
  const out: CellKey[] = [];
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) out.push(cellKey(x, z));
  }
  return out;
}

/** Footprint size on the grid after rotation: odd quarter turns swap width and depth. */
export function rotatedSize(w: number, d: number, rot: Rot): [number, number] {
  return rot % 2 === 0 ? [w, d] : [d, w];
}

/** The edges strictly inside a rectangle of cells (a wall there would cut through whatever stands on it). */
export function interiorEdges(x: number, z: number, w: number, d: number): EdgeKey[] {
  const out: EdgeKey[] = [];
  for (let zz = z + 1; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) out.push(edgeKey("h", xx, zz));
  for (let xx = x + 1; xx < x + w; xx++) for (let zz = z; zz < z + d; zz++) out.push(edgeKey("v", xx, zz));
  return out;
}

export function edgeInLot(e: Edge, w: number, d: number): boolean {
  return e.dir === "h" ? e.x >= 0 && e.x < w && e.z >= 0 && e.z <= d : e.x >= 0 && e.x <= w && e.z >= 0 && e.z < d;
}

export function cellInLot(x: number, z: number, w: number, d: number): boolean {
  return x >= 0 && x < w && z >= 0 && z < d;
}
