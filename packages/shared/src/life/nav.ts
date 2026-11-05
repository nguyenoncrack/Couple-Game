import { STOREY, type Blueprint } from "../blueprint";
import { catalog as defaultCatalog, type Catalog } from "../catalog";
import { cellKey, edgeKey } from "../grid";
import { edgesOfOpening, footprintOf } from "../rules";
import { liftShafts, liftsIn } from "../lifts";
import { flightsOn, stairHoles } from "../stairs";
import { walkableCells } from "./interactions";

/**
 * Where characters can walk. Every lot cell is a node; furniture standing on the floor blocks its cells (rugs
 * don't), and walls block the line between two cells unless a door or archway is in that bit of wall. Windows
 * don't let anyone through. Upstairs you can only stand where there's floor (and not over the stairwell). Stairs
 * join one floor to the next (`findRoute`). The server plans every path with this, and the client draws the same.
 */

export type Cell = [number, number];
/** A cell on a floor: x, z, and which floor. */
export type Spot = [number, number, number];
/** A point on a path: lot metres, and the height above the ground (missing on the ground floor in old saves). */
export type Point = [number, number] | [number, number, number];

/** Which floor a point is on. */
export const levelOf = (p: Point) => Math.max(0, Math.round((p[2] ?? 0) / STOREY));

export interface Nav {
  w: number;
  d: number;
  /** 1 where furniture stands. */
  blocked: Uint8Array;
  walls: Set<string>;
}

const cache = new WeakMap<Blueprint, Nav[]>();

export function buildNav(bp: Blueprint, level = 0, cat: Catalog = defaultCatalog): Nav {
  const hit = cache.get(bp)?.[level];
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
      const open = walkableCells(item, o);
      for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) if (x >= 0 && z >= 0 && x < w && z < d && !open.has(cellKey(x, z))) blocked[z * w + x] = 1;
    }
    for (const key of Object.keys(l.walls)) walls.add(key);
    for (const o of Object.values(l.openings)) {
      const item = cat.openings.get(o.catalogId);
      if (item?.kind === "door") for (const e of edgesOfOpening(item, o)) walls.delete(e);
    }
    // upstairs: nothing to stand on but floor, and not over the stairs coming up or in a lift shaft
    if (level > 0) {
      const holes = stairHoles(bp, level, cat);
      const shafts = liftShafts(bp, level, cat);
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) if (!l.tiles[cellKey(x, z)] || holes.has(cellKey(x, z)) || shafts.has(cellKey(x, z))) blocked[z * w + x] = 1;
    }
  } else blocked.fill(1);
  const nav = { w, d, blocked, walls };
  const navs = cache.get(bp) ?? [];
  navs[level] = nav;
  cache.set(bp, navs);
  return nav;
}

/**
 * A way between floors: up or down one lane of stairs, through `via` (the steps, at their heights), or a ride in a
 * lift (`lift`), from waiting at its doors on one floor to stepping out on another.
 */
export interface Link {
  from: Spot;
  to: Spot;
  via: [number, number, number][];
  cost: number;
  lift?: string;
}

const linkCache = new WeakMap<Blueprint, Map<string, Link[]>>();
const spotKey = (s: Spot) => `${s[2]}:${s[0]}:${s[1]}`;

/** Every way between floors, by the spot it starts from. */
export function linksOf(bp: Blueprint, cat: Catalog = defaultCatalog): Map<string, Link[]> {
  const hit = linkCache.get(bp);
  if (hit) return hit;
  const out = new Map<string, Link[]>();
  const add = (l: Link) => out.set(spotKey(l.from), [...(out.get(spotKey(l.from)) ?? []), l]);
  for (let L = 0; L + 1 < bp.levels.length; L++) {
    const below = buildNav(bp, L, cat);
    const above = buildNav(bp, L + 1, cat);
    for (const { flight } of flightsOn(bp.levels[L], cat)) {
      const [cx, cz] = flight.climb;
      for (const lane of flight.lanes) {
        if (!walkable(below, ...lane.entry) || !walkable(above, ...lane.exit)) continue;
        const n = lane.cells.length;
        const base = L * STOREY;
        const [fx, fz] = lane.cells[0]!;
        const [tx, tz] = lane.cells[n - 1]!;
        const up: [number, number, number][] = [
          [fx + 0.5 - cx / 2, fz + 0.5 - cz / 2, base],
          ...lane.cells.map(([x, z], j): [number, number, number] => [x + 0.5, z + 0.5, base + ((j + 0.5) / n) * STOREY]),
          [tx + 0.5 + cx / 2, tz + 0.5 + cz / 2, base + STOREY],
        ];
        const from: Spot = [...lane.entry, L];
        const to: Spot = [...lane.exit, L + 1];
        // a bit more than walking the same way on the flat, so the stairs aren't taken for a short cut
        const cost = n + 2;
        add({ from, to, via: up, cost });
        add({ from: to, to: from, via: [...up].reverse(), cost });
      }
    }
  }
  // lifts: from any floor they stop at to any other, a bit slower to set off than stairs (there's the wait)
  for (const { o } of liftsIn(bp, cat)) {
    const stops = liftStops(bp, o.id, cat);
    for (const a of stops) for (const b of stops) if (a.level !== b.level) add({ from: [...a.at, a.level], to: [...b.at, b.level], via: [], cost: 6 + 2 * Math.abs(a.level - b.level), lift: o.id });
  }
  linkCache.set(bp, out);
  return out;
}

/** The floors a lift stops at (ground first), each with where you wait for it: floor you can stand on at its doors. */
export function liftStops(bp: Blueprint, liftId: string, cat: Catalog = defaultCatalog): { level: number; at: Cell }[] {
  const lift = liftsIn(bp, cat).find(({ o }) => o.id === liftId);
  if (!lift) return [];
  const out: { level: number; at: Cell }[] = [];
  for (let i = 0; i < bp.levels.length; i++) {
    const nav = buildNav(bp, i, cat);
    const at = lift.shaft.front.find(([x, z]) => walkable(nav, x, z) && !nav.walls.has(lift.shaft.doors[lift.shaft.front.findIndex((f) => f[0] === x && f[1] === z)]!));
    if (at) out.push({ level: i, at });
  }
  return out;
}

/** The way up or down from one spot to the next, if they're the two ends of some stairs or a lift ride (the quicker). */
export function linkBetween(bp: Blueprint, from: Spot, to: Spot, cat: Catalog = defaultCatalog): Link | undefined {
  let best: Link | undefined;
  for (const l of linksOf(bp, cat).get(spotKey(from)) ?? []) if (l.to[0] === to[0] && l.to[1] === to[1] && l.to[2] === to[2] && (!best || l.cost < best.cost)) best = l;
  return best;
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

/**
 * Is there room to stand at a point (lot metres) with a body this wide: on an open cell, and no closer than
 * `r` to a wall or anything blocked beside it?
 */
export function roomAt(nav: Nav, x: number, z: number, r: number): boolean {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (!walkable(nav, cx, cz)) return false;
  for (const sx of [-1, 0, 1])
    for (const sz of [-1, 0, 1]) {
      if (!sx && !sz) continue;
      // how far to that side (or corner) of the cell
      const gx = sx < 0 ? x - cx : sx > 0 ? cx + 1 - x : 0;
      const gz = sz < 0 ? z - cz : sz > 0 ? cz + 1 - z : 0;
      if (Math.hypot(gx, gz) >= r) continue;
      if (!canStep(nav, cx, cz, cx + sx, cz + sz)) return false;
    }
  return true;
}

/**
 * How far a body can get going straight from one point towards another: the last spot along the way with room
 * to stand, never through a wall. Running into something slides along it instead, as walking into a wall does.
 */
export function slide(nav: Nav, from: [number, number], to: [number, number], r: number): [number, number] {
  const along = (target: [number, number]): [number, number] => {
    const at = (k: number): [number, number] => [from[0] + (target[0] - from[0]) * k, from[1] + (target[1] - from[1]) * k];
    const ok = (a: [number, number], b: [number, number]) => {
      const [x0, z0] = [Math.floor(a[0]), Math.floor(a[1])];
      const [x1, z1] = [Math.floor(b[0]), Math.floor(b[1])];
      return roomAt(nav, b[0], b[1], r) && ((x0 === x1 && z0 === z1) || canStep(nav, x0, z0, x1, z1));
    };
    const n = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[1] - from[1]) / 0.05));
    let good = 0;
    for (let i = 1; i <= n; i++) {
      if (!ok(at(good), at(i / n))) {
        // close in on exactly where it stops being open, so you can walk right up to a wall
        let bad = i / n;
        for (let j = 0; j < 10; j++) {
          const mid = (good + bad) / 2;
          if (ok(at(good), at(mid))) good = mid;
          else bad = mid;
        }
        break;
      }
      good = i / n;
    }
    return at(good);
  };
  const gone = (p: [number, number]) => Math.hypot(p[0] - from[0], p[1] - from[1]);
  const straight = along(to);
  if (gone(straight) >= Math.hypot(to[0] - from[0], to[1] - from[1]) - 1e-6) return straight;
  // blocked: try just the part of the way along each axis, and go with whichever gets further
  const best = [straight, along([to[0], from[1]]), along([from[0], to[1]])].reduce((a, b) => (gone(b) > gone(a) + 1e-6 ? b : a));
  return best;
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

/**
 * The shortest way from a spot to the nearest of several goal spots, on any floor, going up and down stairs as
 * needed (A* over every floor at once). Like `findPath`, the start may be blocked. Null if no goal can be reached.
 */
export function findRoute(bp: Blueprint, from: Spot, goals: Spot[], cat: Catalog = defaultCatalog, maxNodes = 40_000): Spot[] | null {
  const navs = bp.levels.map((_, i) => buildNav(bp, i, cat));
  // all on one floor, no stairs to think about: the plain search
  if (goals.every((g) => g[2] === from[2]) && bp.levels.length === 1) {
    const cells = findPath(navs[from[2]]!, [from[0], from[1]], goals.map((g) => [g[0], g[1]] as Cell), maxNodes);
    return cells && cells.map(([x, z]) => [x, z, from[2]]);
  }
  const links = linksOf(bp, cat);
  const goalSet = new Set(goals.filter(([x, z, l]) => navs[l] && walkable(navs[l]!, x, z)).map(spotKey));
  if (goalSet.size === 0) return null;
  const start = spotKey(from);
  if (goalSet.has(start)) return [from];
  const targets = goals.filter((g) => goalSet.has(spotKey(g)));
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
  const spotOf = new Map<string, Spot>([[start, from]]);
  // a plain sorted queue is plenty for a house
  const open: [number, Spot][] = [[h(from[0], from[1]), from]];
  const closed = new Set<string>();
  while (open.length && closed.size < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]![0] < open[bi]![0]) bi = i;
    const [, here] = open.splice(bi, 1)[0]!;
    const key = spotKey(here);
    if (closed.has(key)) continue;
    closed.add(key);
    if (goalSet.has(key)) {
      const path: Spot[] = [here];
      let k = key;
      while (came.has(k)) {
        k = came.get(k)!;
        path.push(spotOf.get(k)!);
      }
      return path.reverse();
    }
    const [x, z, L] = here;
    const nav = navs[L]!;
    const gHere = g.get(key)!;
    const next: [Spot, number][] = [];
    for (const [dx, dz, cost] of STEPS) if (canStep(nav, x, z, x + dx, z + dz)) next.push([[x + dx, z + dz, L], cost]);
    for (const l of links.get(key) ?? []) next.push([l.to, l.cost]);
    for (const [s, cost] of next) {
      const nk = spotKey(s);
      const ng = gHere + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, key);
        spotOf.set(nk, s);
        open.push([ng + h(s[0], s[1]), s]);
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
