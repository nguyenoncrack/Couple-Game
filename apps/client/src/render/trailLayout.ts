import * as THREE from "three";
import type { FlowerKind } from "./botanicalModels";
import { campLayout, lakeShape } from "./sceneryLayout";

/**
 * The countryside's footpaths, worked out from the lot's size alone, so both players always see the same ones and
 * nothing here touches the house, its navigation or the server. The campsite's own trails (street → fire → cabin
 * porch) stay as they were; from the porch a lake trail winds round behind the lot to the jetty, a meadow trail
 * carries on from there to the playground, and a short spur takes the playground back to the pavement, so the
 * whole countryside makes one loop. Signposts stand at the junctions, a few patches of flowers sit in the bends,
 * and stepping stones cross the soft ground near the water.
 */

type XZ = [number, number];

export interface Trail {
  name: string;
  points: XZ[];
  /** Width of the dirt, in metres. */
  width: number;
  /** Stretches (as fractions of the trail) laid with stepping stones. */
  stones: [number, number][];
}

export interface Signpost {
  x: number;
  z: number;
  /** One arm per way you can go: the point it aims at and the colour its tip is painted. */
  arms: { toward: XZ; tip: string }[];
}

export interface FlowerPatch {
  x: number;
  z: number;
  radius: number;
  kind: FlowerKind;
  tone: string;
  count: number;
  seed: number;
}

/** Room deliberately left empty: later scenery keeps out of it too. */
export interface Clearing {
  x: number;
  z: number;
  r: number;
}

export interface TrailNetwork {
  trails: Trail[];
  /** The campsite's trails, already drawn by the campsite: here so clearances can see them. */
  campTrails: XZ[][];
  signs: Signpost[];
  patches: FlowerPatch[];
  /** Worn bare earth, where feet gather at junctions. */
  bare: Clearing[];
  open: Clearing[];
}

/** Tip colours: each destination keeps its own, on every signpost. */
export const SIGN_TIP = { lake: "#4f9fd6", cabin: "#b8503e", play: "#f5c537", street: "#a8a397" } as const;

const PALETTE: { kind: FlowerKind; tone: string }[] = [
  { kind: "daisy", tone: "#f5eed9" },
  { kind: "lavender", tone: "#9a8cb4" },
  { kind: "tulip", tone: "#e5604a" },
  { kind: "daisy", tone: "#dc9c9b" },
  { kind: "tulip", tone: "#f5c537" },
];

export function trailCurve(points: XZ[]) {
  return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
}

const made = new Map<string, TrailNetwork>();

/** The footpaths for a lot size; worked out once, since the meadow asks again on every edit to the house. */
export function trailNetwork(w: number, d: number): TrailNetwork {
  const key = `${w}:${d}`;
  let net = made.get(key);
  if (!net) made.set(key, (net = makeNetwork(w, d)));
  return net;
}

function makeNetwork(w: number, d: number): TrailNetwork {
  const lake = lakeShape(w);
  const camp = campLayout(d);
  const { cabin, fire } = camp;
  const dockX = lake.cx + 3;
  const shoreZ = lake.cz + lake.rz * lake.reach(Math.PI / 2);
  /** Where the lake trail meets the meadow trail, a few metres back from the jetty. */
  const fork: XZ = [dockX - 0.8, shoreZ + 3.4];
  const porch: XZ = [cabin.x + 3.4, cabin.z - 0.6];
  const dock: XZ = [dockX, shoreZ + 0.7];
  const playN: XZ = [w + 6.8, d / 2 - 3.6];
  const playS: XZ = [w + 6.9, d / 2 + 4.4];
  const street: XZ = [w + 7.0, d + 0.9];

  const trails: Trail[] = [
    {
      name: "lake",
      // north from the cabin porch, round the back corner of the fence, behind the hedge and the two trees
      points: [porch, [cabin.x + 4.0, Math.min(cabin.z - 3.4, 2.6)], [cabin.x + 2.8, -0.8], [-6.0, -4.2], [-2.4, -5.6], [0.8, -8.6], [4.4, -8.0], [fork[0] - 3.6, fork[1] + 1.0], fork, dock],
      width: 0.95,
      stones: [[0.9, 0.985]],
    },
    {
      name: "meadow",
      // east along the lake side of the back meadow, dipping toward the water, then down past the playground's far corner
      points: [fork, [dockX + 3.1, shoreZ + 2.6], [dockX + 6.1, shoreZ + 5.2], [dockX + 9.1, shoreZ + 4.0], [w + 2.4, -7.4], [w + 6.4, -4.6], [w + 5.4, -1.0], [w + 7.6, 2.2], playN],
      width: 0.9,
      stones: [[0.42, 0.52]],
    },
    {
      name: "street",
      points: [playS, [w + 8.0, d - 2.2], street],
      width: 0.85,
      stones: [],
    },
  ];

  const curves = trails.map((t) => trailCurve(t.points));
  /** A point beside a trail: `at` metres along it (negative counts from the end), `side` metres to its left. */
  const beside = (i: number, at: number, side: number): XZ => {
    const c = curves[i]!;
    const u = (at < 0 ? c.getLength() + at : at) / c.getLength();
    const p = c.getPointAt(u);
    const t = c.getTangentAt(u);
    return [p.x + t.z * side, p.z - t.x * side];
  };

  const along = curves.map((c) => c.getSpacedPoints(Math.ceil(c.getLength() * 4)));
  /** Of the spots `r` metres round a point, the one furthest from every trail: where a junction's signpost goes. */
  const aside = (at: XZ, r: number): XZ => {
    let best: XZ = at;
    let room = -1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = at[0] + Math.cos(a) * r;
      const z = at[1] + Math.sin(a) * r;
      const gap = Math.min(...along.flat().map((v) => Math.hypot(v.x - x, v.z - z)));
      if (gap > room) [best, room] = [[x, z], gap];
    }
    return best;
  };
  const lakeBack = beside(0, 9, 0);
  const spots: { at: XZ; arms: Signpost["arms"] }[] = [
    { at: beside(0, 1.6, -1.0), arms: [{ toward: lakeBack, tip: SIGN_TIP.lake }, { toward: [fire[0], fire[2]], tip: SIGN_TIP.cabin }] },
    { at: aside(fork, 1.7), arms: [{ toward: dock, tip: SIGN_TIP.lake }, { toward: beside(0, -9, 0), tip: SIGN_TIP.cabin }, { toward: beside(1, 6, 0), tip: SIGN_TIP.play }] },
    { at: beside(1, -1.4, -1.0), arms: [{ toward: beside(1, -8, 0), tip: SIGN_TIP.lake }, { toward: [w + 5, d / 2 + 0.5], tip: SIGN_TIP.play }] },
    { at: beside(2, -1.6, 1.0), arms: [{ toward: [w + 5, d / 2 + 0.5], tip: SIGN_TIP.play }, { toward: [w + 2, d + 2], tip: SIGN_TIP.street }] },
  ];
  const signs: Signpost[] = spots.map(({ at, arms }) => ({ x: at[0], z: at[1], arms }));

  const bare: Clearing[] = [
    { x: fork[0], z: fork[1], r: 1.5 },
    { x: dock[0], z: dock[1] - 0.2, r: 1.1 },
    { x: playN[0], z: playN[1], r: 1.0 },
  ];
  // flowers grow on the meadow, not on the beach, a worn patch or under a signpost
  const patches = bendPatches(curves, (x, z) =>
    !lake.inside(x, z, 3) && !bare.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 1) && !signs.some((sg) => Math.hypot(sg.x - x, sg.z - z) < 1.6),
  );
  // the back lawn behind the hedge, and the strip of meadow along the lake's east shore: kept quiet on purpose
  const open: Clearing[] = [
    { x: w * 0.5, z: -5.0, r: 2.6 },
    { x: w + 6, z: -10.5, r: 3.2 },
  ];
  return { trails, campTrails: camp.trails, signs, patches, bare, open };
}

/**
 * A patch of one kind of flower inside each clear bend: where the trail turns hardest, set back from it on the
 * inside of the turn, at most one every eight metres, wherever `room` allows.
 */
function bendPatches(curves: THREE.CatmullRomCurve3[], room: (x: number, z: number) => boolean): FlowerPatch[] {
  const STEP = 0.5;
  const REACH = 2.5;
  const patches: FlowerPatch[] = [];
  curves.forEach((c, ci) => {
    const len = c.getLength();
    const n = Math.floor(len / STEP);
    const heading = (s: number) => {
      const t = c.getTangentAt(Math.min(1, Math.max(0, s / len)));
      return Math.atan2(t.z, t.x);
    };
    const turns: { s: number; turn: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const s = i * STEP;
      if (s < REACH + 1 || s > len - REACH - 1) continue;
      let turn = heading(s + REACH) - heading(s - REACH);
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      turns.push({ s, turn });
    }
    const picked: number[] = [];
    for (const { s, turn } of [...turns].sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn))) {
      if (Math.abs(turn) < 0.3 || picked.some((p) => Math.abs(p - s) < 7)) continue;
      const p = c.getPointAt(s / len);
      const t = c.getTangentAt(s / len);
      // a left turn (heading increasing, seen from above with z down the page) bends toward +normal
      const side = Math.sign(turn);
      const off = 1.35 + Math.min(0.6, Math.abs(turn) * 0.4);
      const x = p.x - t.z * off * side;
      const z = p.z + t.x * off * side;
      if (!room(x, z)) continue;
      picked.push(s);
      const look = PALETTE[(patches.length + ci * 2) % PALETTE.length]!;
      patches.push({ x, z, radius: 0.75 + Math.min(0.35, Math.abs(turn) * 0.3), ...look, count: 13 + Math.round(Math.abs(turn) * 4), seed: 97 + patches.length * 31 });
    }
  });
  return patches;
}

const CELL = 2;

/**
 * Is a point within `r` metres (up to 2) of the middle of any trail, camp trails included? Trails are sampled
 * every quarter metre into a coarse grid, so the meadow's thousands of checks each look at a handful of points.
 */
export function nearTrail(net: TrailNetwork) {
  let grid = grids.get(net);
  if (!grid) grids.set(net, (grid = trailGrid(net)));
  const cells = grid;
  return (x: number, z: number, r: number) => {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gz - 1; j <= gz + 1; j++) for (const v of cells.get(`${i}:${j}`) ?? []) if (Math.hypot(v.x - x, v.z - z) < r) return true;
    return false;
  };
}

const grids = new WeakMap<TrailNetwork, Map<string, THREE.Vector3[]>>();

function trailGrid(net: TrailNetwork) {
  const grid = new Map<string, THREE.Vector3[]>();
  for (const p of [...net.trails.map((t) => t.points), ...net.campTrails]) {
    const c = trailCurve(p);
    for (const v of c.getSpacedPoints(Math.ceil(c.getLength() * 4))) {
      const key = `${Math.floor(v.x / CELL)}:${Math.floor(v.z / CELL)}`;
      const list = grid.get(key) ?? [];
      list.push(v);
      grid.set(key, list);
    }
  }
  return grid;
}
