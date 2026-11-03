import type { Blueprint } from "../blueprint";
import { catalog as defaultCatalog, type Catalog } from "../catalog";
import { cellKey, edgeKey } from "../grid";
import { edgesOfOpening, footprintOf } from "../rules";

/**
 * Where characters can walk. Every lot cell is a node; furniture standing on the floor blocks its cells (rugs
 * don't), and walls block the line between two cells unless a door or archway is in that bit of wall. Windows
 * don't let anyone through. The server plans every path with this, and the client draws the same thing.
 */

export type Cell = [number, number];

export interface Nav {
  w: number;
  d: number;
  /** 1 where furniture stands. */
  blocked: Uint8Array;
  walls: Set<string>;
}

const cache = new WeakMap<Blueprint, Nav>();

export function buildNav(bp: Blueprint, level = 0, cat: Catalog = defaultCatalog): Nav {
  const hit = level === 0 ? cache.get(bp) : undefined;
  if (hit) return hit;
  const l = bp.levels[level];
  const { w, d } = bp.lot;
  const blocked = new Uint8Array(w * d);
  const walls = new Set<string>();
  if (l) {
    for (const o of Object.values(l.objects)) {
      const item = cat.furniture.get(o.catalogId);
      if (!item || item.layer !== "floor") continue;
      const f = footprintOf(item, o);
      for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) if (x >= 0 && z >= 0 && x < w && z < d) blocked[z * w + x] = 1;
    }
    for (const key of Object.keys(l.walls)) walls.add(key);
    for (const o of Object.values(l.openings)) {
      const item = cat.openings.get(o.catalogId);
      if (item?.kind === "door") for (const e of edgesOfOpening(item, o)) walls.delete(e);
    }
  }
  const nav = { w, d, blocked, walls };
  if (level === 0) cache.set(bp, nav);
  return nav;
}

export function walkable(nav: Nav, x: number, z: number) {
  return x >= 0 && z >= 0 && x < nav.w && z < nav.d && nav.blocked[z * nav.w + x] === 0;
}

/** Is there a wall on the line between two side-by-side cells? */
function wallBetween(nav: Nav, x0: number, z0: number, x1: number, z1: number) {
  if (x1 !== x0) return nav.walls.has(edgeKey("v", Math.max(x0, x1), z0));
  return nav.walls.has(edgeKey("h", x0, Math.max(z0, z1)));
}

/** Can a character step from one cell to a neighbouring one (diagonals can't squeeze past a corner)? */
export function canStep(nav: Nav, x0: number, z0: number, x1: number, z1: number): boolean {
  if (!walkable(nav, x1, z1)) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  if (Math.abs(dx) + Math.abs(dz) === 1) return !wallBetween(nav, x0, z0, x1, z1);
  if (Math.abs(dx) !== 1 || Math.abs(dz) !== 1) return false;
  // both ways around the corner must be open
  return (
    walkable(nav, x1, z0) &&
    walkable(nav, x0, z1) &&
    !wallBetween(nav, x0, z0, x1, z0) &&
    !wallBetween(nav, x1, z0, x1, z1) &&
    !wallBetween(nav, x0, z0, x0, z1) &&
    !wallBetween(nav, x0, z1, x1, z1)
  );
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * The shortest way from a cell to the nearest of several goal cells (A*), start and goal included. The start may
 * be blocked (furniture was just put there); the path still leads out of it. Null if no goal can be reached.
 */
export function findPath(nav: Nav, from: Cell, goals: Cell[], maxNodes = 20_000): Cell[] | null {
  const goalSet = new Set(goals.filter(([x, z]) => walkable(nav, x, z)).map(([x, z]) => cellKey(x, z)));
  if (goalSet.size === 0) return null;
  const start = cellKey(from[0], from[1]);
  if (goalSet.has(start)) return [from];
  const targets = [...goalSet].map((k) => k.split(":").map(Number) as Cell);
  // octile distance to the closest goal
  const h = (x: number, z: number) => {
    let best = Infinity;
    for (const [gx, gz] of targets) {
      const dx = Math.abs(gx - x);
      const dz = Math.abs(gz - z);
      best = Math.min(best, Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz));
    }
    return best;
  };
  const g = new Map<string, number>([[start, 0]]);
  const came = new Map<string, string>();
  // A small binary heap keyed by f = g + h.
  const heap: [number, number, number][] = [[h(from[0], from[1]), from[0], from[1]]];
  const push = (n: [number, number, number]) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const closed = new Set<string>();
  while (heap.length && closed.size < maxNodes) {
    const [, x, z] = pop();
    const key = cellKey(x, z);
    if (closed.has(key)) continue;
    closed.add(key);
    if (goalSet.has(key)) {
      const path: Cell[] = [[x, z]];
      let k = key;
      while (came.has(k)) {
        k = came.get(k)!;
        path.push(k.split(":").map(Number) as Cell);
      }
      return path.reverse();
    }
    const gHere = g.get(key)!;
    for (const [dx, dz, cost] of STEPS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!canStep(nav, x, z, nx, nz)) continue;
      const nk = cellKey(nx, nz);
      const ng = gHere + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, key);
        push([ng + h(nx, nz), nx, nz]);
      }
    }
  }
  return null;
}

/** The walkable cell nearest to this one (itself if it's free), for when furniture lands on someone. */
export function nearestWalkable(nav: Nav, from: Cell): Cell | null {
  if (walkable(nav, from[0], from[1])) return from;
  const seen = new Set([cellKey(from[0], from[1])]);
  let ring: Cell[] = [from];
  while (ring.length) {
    const next: Cell[] = [];
    for (const [x, z] of ring) {
      for (const [dx, dz] of STEPS) {
        const c: Cell = [x + dx, z + dz];
        const k = cellKey(c[0], c[1]);
        if (seen.has(k) || c[0] < 0 || c[1] < 0 || c[0] >= nav.w || c[1] >= nav.d) continue;
        seen.add(k);
        if (walkable(nav, c[0], c[1])) return c;
        next.push(c);
      }
    }
    ring = next;
  }
  return null;
}
