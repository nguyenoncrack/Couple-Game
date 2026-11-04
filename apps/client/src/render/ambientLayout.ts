import { WIND } from "./pencil";
import { lakeShape } from "./sceneryLayout";
import { scenesLayout } from "./scenesLayout";
import { shoreLayout } from "./shoreLayout";
import { trailNetwork } from "./trailLayout";
import { woodsLayout } from "./woodsLayout";

/**
 * Where the countryside's small life goes (see Ambient): butterflies over the flower patches, birds circling over
 * the lake and the meadow, leaves let go by the leafy trees nearest the meadow, and rings spreading on the water
 * by the reeds, the lilies, the jetty and the boat. Worked out from the lot's size alone; the motion itself is
 * all cosmetic and local to each player.
 */

type XZ = [number, number];

export interface Flock {
  x: number;
  z: number;
  /** Radius of the circle they ride round, and how high. */
  r: number;
  y: number;
  birds: number;
  /** Turns per second; negative circles the other way. */
  speed: number;
}

export interface LeafTree {
  x: number;
  z: number;
  /** Height of the bottom of the crown, where leaves let go. */
  y: number;
  /** How far the crown spreads. */
  spread: number;
}

export interface Ripple {
  x: number;
  z: number;
  /** Widest radius, in metres, and seconds between rings. */
  size: number;
  period: number;
  /** Offset into the cycle, 0..1, so neighbours don't pulse together. */
  phase: number;
}

export interface Ambient {
  butterflies: XZ[];
  flocks: Flock[];
  leafTrees: LeafTree[];
  ripples: Ripple[];
}

export const MAX_BUTTERFLIES = 12;
export const LEAVES = 36;
/** How far (metres) leaves drift downwind on the way down. */
export const LEAF_DRIFT = 2.6;

const made = new Map<string, Ambient>();

export function ambientLayout(w: number, d: number): Ambient {
  const key = `${w}:${d}`;
  let a = made.get(key);
  if (!a) made.set(key, (a = makeAmbient(w, d)));
  return a;
}

function makeAmbient(w: number, d: number): Ambient {
  const net = trailNetwork(w, d);
  const scenes = scenesLayout(w, d);
  const shore = shoreLayout(w, d);
  const lake = lakeShape(w);
  const woods = woodsLayout(w, d);

  // a butterfly for each flower patch by the trails and one for the cabin's flower bed
  const bed: XZ = [scenes.flowerBed.x, scenes.flowerBed.z];
  const butterflies = [...net.patches.map((p): XZ => [p.x, p.z]), bed].slice(0, MAX_BUTTERFLIES);

  const flocks: Flock[] = [
    { x: lake.cx, z: lake.cz + 4, r: 13, y: 9, birds: 4, speed: 0.022 },
    { x: w + 12, z: -2, r: 9, y: 7.5, birds: 3, speed: -0.03 },
  ];

  // the broad-leaved trees standing nearest the meadow, whose leaves land outside the lot
  const cx = w / 2;
  const cz = d / 2;
  const lands = (x: number, z: number) => [x + WIND[0] * LEAF_DRIFT, z + WIND[1] * LEAF_DRIFT] as const;
  const leafTrees = woods.trees
    .filter((t) => t.kind === "leafy" || t.kind === "birch" || t.kind === "tall")
    .filter((t) => {
      const [x, z] = lands(t.x, t.z);
      return !(x > -3 && x < w + 3 && z > -3 && z < d + 1.5) && !lake.inside(x, z, 1);
    })
    .map((t) => ({ t, dist: Math.hypot(t.x - cx, t.z - cz) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 14)
    .map(({ t }) => ({ x: t.x, z: t.z, y: (t.kind === "birch" ? 3.0 : 2.4) * t.s * t.h, spread: (t.kind === "birch" ? 0.7 : 1.0) * t.s }));

  // rings on the water: at the foot of each reed bed, among the lilies, round the jetty's posts and by the boat
  const ripples: Ripple[] = [];
  let n = 0;
  const ring = (x: number, z: number, size: number, period: number) => {
    if (lake.inside(x, z, -0.3)) ripples.push({ x, z, size, period, phase: (n++ * 0.618) % 1 });
  };
  for (const bed of shore.reeds) {
    for (const off of [-0.5, 0.5]) {
      const [x, z] = shore.edge(bed.a + off * bed.spread, -1.4);
      ring(x, z, 0.55, 4.5 + (n % 3));
    }
  }
  for (const l of shore.lilies) ring(l.x + l.r * 0.3, l.z - l.r * 0.2, 0.7, 6);
  for (let k = 2; k <= 4; k++) for (const s of [-1, 1]) ring(shore.dock.x + s * 0.68, shore.dock.shoreZ + 0.4 - k * 1.75, 0.45, 3.5 + k * 0.4);
  ring(shore.boat.x + 0.8, shore.boat.z + 0.5, 0.6, 3.2);
  ring(shore.boat.x - 0.75, shore.boat.z - 0.8, 0.6, 3.9);
  // and now and then a fish rising out in the open water
  for (const [ox, oz] of [[-9, -3], [6, -6], [-2, -9], [12, -2]] as const) ring(lake.cx + ox, lake.cz + oz, 1.1, 9);

  return { butterflies, flocks, leafTrees, ripples: ripples.slice(0, 28) };
}
