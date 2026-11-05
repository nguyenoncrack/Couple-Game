import { catalog } from "../catalog";
import type { Blueprint } from "../blueprint";
import { cellKey, edgeKey, type EdgeKey, type CellKey } from "../grid";
import type { Op, SingleOp } from "../ops";
import { stairHoles } from "../stairs";
import { liftShafts } from "../lifts";

export interface MaterialRoom { cells: CellKey[]; walls: EdgeKey[] }

/** Doors/windows remain boundaries: painting a room must never spill into its neighbour through a doorway. */
export function materialRoom(bp: Blueprint, levelIndex: number, x: number, z: number): MaterialRoom | null {
  const level = bp.levels[levelIndex], { w, d } = bp.lot;
  if (!level || x < 0 || z < 0 || x >= w || z >= d) return null;
  const seen = new Set<CellKey>([cellKey(x, z)]), walls = new Set<EdgeKey>(), queue = [[x, z]];
  for (let i = 0; i < queue.length; i++) {
    const [cx, cz] = queue[i]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const edge = dx ? edgeKey("v", cx! + (dx > 0 ? 1 : 0), cz!) : edgeKey("h", cx!, cz! + (dz > 0 ? 1 : 0));
      if (level.walls[edge]) { walls.add(edge); continue; }
      const nx = cx! + dx, nz = cz! + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) return null;
      const key = cellKey(nx, nz);
      if (!seen.has(key)) { seen.add(key); queue.push([nx, nz]); }
    }
  }
  return { cells: [...seen], walls: [...walls] };
}

/** Same saved fields and synchronized ops as drawing. Repaint existing surfaces only; preserve floor voids. */
export function materialPaintOp(bp: Blueprint, level: number, kind: "wall" | "floor", targets: string[], id: string): Op | null {
  const l = bp.levels[level];
  if (!l) return null;
  const holes = kind === "floor" ? stairHoles(bp, level, catalog) : new Set<string>();
  if (kind === "floor") for (const key of liftShafts(bp, level, catalog)) holes.add(key);
  const changed = [...new Set(targets)].filter((key) => kind === "wall" ? l.walls[key] && l.walls[key].style !== id : l.tiles[key] && !holes.has(key) && l.tiles[key].material !== id);
  if (!changed.length) return null;
  const ops: SingleOp[] = [], limit = kind === "wall" ? 512 : 1024;
  for (let i = 0; i < changed.length; i += limit) ops.push(kind === "wall"
    ? { t: "walls.add", level, edges: changed.slice(i, i + limit), style: id, existingOnly: true }
    : { t: "floor.paint", level, cells: changed.slice(i, i + limit), material: id, existingOnly: true });
  return ops.length === 1 ? ops[0]! : { t: "batch", ops };
}
