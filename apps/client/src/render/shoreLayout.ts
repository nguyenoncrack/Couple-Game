import { lakeShape } from "./sceneryLayout";
import { trailCurve, trailNetwork } from "./trailLayout";

/**
 * What lies along the lake's shore, worked out from the lot's size alone (the same for both players, nothing sent
 * to the server). Places round the shore are given by angle: 0 is east, π/2 the near shore facing the house, -π/2
 * the far shore. The beach comes and goes: wide sand by the jetty and on the far shore, grass right down to the
 * water where reeds grow. Small things (pebbles, lily flowers, the seating spot) stay on the near half, where
 * they're seen up close; the far shore gets bigger rocks and reed beds that still read from across the water.
 */

type XZ = [number, number];

export interface Spot {
  x: number;
  z: number;
  /** Size, in metres: a patch's radius, a rock group's biggest rock. */
  r: number;
  seed: number;
}

export interface ReedBed extends Spot {
  /** Angle round the shore, and how far either side of it (radians) the bed spreads. */
  a: number;
  spread: number;
  count: number;
}

export interface ShoreLayout {
  beachWidth: (a: number) => number;
  /** The same, as a fraction of the lake's radius at that angle (how the shore disc is drawn). */
  beachGrow: (a: number) => number;
  /** A point on the water's edge at angle `a`, pushed `out` metres away from the water (negative: into it). */
  edge: (a: number, out?: number) => XZ;
  reeds: ReedBed[];
  rocks: Spot[];
  pebbles: Spot[];
  lilies: Spot[];
  seat: { x: number; z: number; facing: number; stones: XZ[] };
  dock: { x: number; shoreZ: number };
  boat: { x: number; z: number; ry: number };
  /** Ground the meadow grass keeps off. */
  clearings: Spot[];
}

/** Wide stretches of sand, as [angle, half-width (radians), metres]. */
const BEACHES: [number, number, number][] = [
  [1.45, 0.22, 2.0], // by the jetty
  [1.95, 0.12, 1.4], // the seating spot
  [-1.35, 0.35, 1.8], // the far shore
  [0.25, 0.18, 1.1],
];

/** Reed beds, as [angle, spread, stalks]: where they stand the grass runs right down to the water. */
const REEDS: [number, number, number][] = [
  [2.5, 0.16, 48],
  [0.85, 0.13, 40],
  [3.35, 0.2, 44],
  [-0.85, 0.16, 38],
  [-2.3, 0.14, 36],
];

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const made = new Map<string, ShoreLayout>();

/** The shore for a lot size; worked out once, since the meadow asks again on every edit to the house. */
export function shoreLayout(w: number, d: number): ShoreLayout {
  const key = `${w}:${d}`;
  let layout = made.get(key);
  if (!layout) made.set(key, (layout = makeShore(w, d)));
  return layout;
}

function makeShore(w: number, d: number): ShoreLayout {
  const lake = lakeShape(w);
  const radius = (a: number) => Math.hypot(lake.rx * Math.cos(a), lake.rz * Math.sin(a));
  const edge = (a: number, out = 0): XZ => {
    const f = lake.reach(a) + out / radius(a);
    return [lake.cx + Math.cos(a) * lake.rx * f, lake.cz + Math.sin(a) * lake.rz * f];
  };
  const bump = (a: number, at: number, half: number) => Math.exp(-((wrap(a - at) / half) ** 2));
  const beachWidth = (a: number) => {
    let width = 0.55;
    for (const [at, half, m] of BEACHES) width += (m - 0.55) * bump(a, at, half);
    for (const [at, spread] of REEDS) width *= 1 - 0.8 * bump(a, at, spread * 1.3);
    return width;
  };

  const reeds: ReedBed[] = REEDS.map(([a, spread, count], i) => {
    const [x, z] = edge(a);
    return { a, spread, count, x, z, r: spread * radius(a), seed: 41 + i * 13 };
  });

  // rocks in groups: on the near shore between the beaches, bigger ones on the far shore, some in the shallows
  const rocks: Spot[] = (
    [
      [2.17, -0.3, 0.9],
      [1.08, 0.2, 0.8],
      [1.68, 0.6, 0.55],
      [-0.25, 0.1, 1.5],
      [-1.9, -0.4, 1.7],
      [2.95, 0.2, 1.4],
      [-2.75, 0.5, 1.2],
    ] as const
  ).map(([a, out, r], i) => {
    const [x, z] = edge(a, out);
    return { x, z, r, seed: 7 + i * 17 };
  });

  const pebbles: Spot[] = (
    [
      [1.27, 0.7, 1.0],
      [1.62, 1.0, 0.8],
      [2.16, 0.7, 0.8],
      [0.3, 0.6, 0.9],
    ] as const
  ).map(([a, out, r], i) => {
    const [x, z] = edge(a, out);
    return { x, z, r, seed: 3 + i * 29 };
  });

  // lilies float in the lee of the two near reed beds, a little way out
  const lilies: Spot[] = (
    [
      [2.42, -3.4, 1.4],
      [2.62, -2.6, 0.8],
      [0.8, -2.8, 1.1],
    ] as const
  ).map(([a, out, r], i) => {
    const [x, z] = edge(a, out);
    return { x, z, r, seed: 19 + i * 23 };
  });

  // two chairs on the near shore, looking out over the water, with stepping stones in from the lake trail
  const seatA = 1.95;
  const [sx, sz] = edge(seatA, 2.6);
  // look straight out at the nearest water (on an oval that isn't back toward the middle)
  let [wx, wz] = edge(seatA);
  for (let a = seatA - 0.4; a <= seatA + 0.4; a += 0.01) {
    const [ex, ez] = edge(a);
    if (Math.hypot(ex - sx, ez - sz) < Math.hypot(wx - sx, wz - sz)) [wx, wz] = [ex, ez];
  }
  const facing = Math.atan2(wz - sz, wx - sx);
  const trail = trailCurve(trailNetwork(w, d).trails[0]!.points).getSpacedPoints(300);
  const near = trail.reduce((best, p) => (Math.hypot(p.x - sx, p.z - sz) < Math.hypot(best.x - sx, best.z - sz) ? p : best));
  const stones: XZ[] = [];
  const gap = Math.hypot(near.x - sx, near.z - sz);
  // from just off the trail's edge to just short of the chairs
  for (let s = 0.75; s < gap - 1.1; s += 0.7) {
    const t = s / gap;
    const wob = Math.sin(s * 2.7) * 0.12;
    stones.push([near.x + (sx - near.x) * t + wob, near.z + (sz - near.z) * t - wob]);
  }

  const dockX = lake.cx + 3;
  const shoreZ = lake.cz + lake.rz * lake.reach(Math.PI / 2);
  const boat = { x: dockX + 1.55, z: shoreZ - 3.7, ry: 0.12 };

  const clearings: Spot[] = [{ x: sx, z: sz, r: 1.6, seed: 0 }, ...pebbles];
  return { beachWidth, beachGrow: (a) => beachWidth(a) / radius(a), edge, reeds, rocks, pebbles, lilies, seat: { x: sx, z: sz, facing, stones }, dock: { x: dockX, shoreZ }, boat, clearings };
}
