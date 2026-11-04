import { campLayout, lakeShape, STREET_REACH } from "./sceneryLayout";
import { scenesLayout } from "./scenesLayout";
import { shoreLayout } from "./shoreLayout";
import { nearTrail, trailNetwork } from "./trailLayout";

/**
 * The woods round the countryside, worked out from the lot's size alone (the same for both players; nothing sent
 * to the server). The forest's edge wanders in and out round the lot; outside it trees grow in groves — firs
 * deep in, leafy trees and birches toward the light, young ones round each grove's rim — with scattered trees
 * between to keep the back of the forest thick. In front of the edge the meadow takes over: a few lone trees,
 * then bushes, ferns, stumps, logs, fallen branches and mushrooms that thin out the further they are from the
 * trees. Small things stay within sight of the lot; the far forest is trees only.
 */

export type TreeKind = "fir" | "spire" | "leafy" | "tall" | "birch" | "sapling";

export interface Tree {
  x: number;
  z: number;
  kind: TreeKind;
  /** Overall size, and extra height on top of it. */
  s: number;
  h: number;
  /** Which of the kind's colours. */
  tone: number;
  seed: number;
}

export interface Thing {
  x: number;
  z: number;
  ry: number;
  s: number;
  /** Which variant of the model. */
  v: number;
}

export type UnderKind = "bush" | "fern" | "stump" | "log" | "branch" | "mushrooms";

export interface Woods {
  /** How far out from the lot's middle the forest proper begins, by angle. */
  edge: (a: number) => number;
  trees: Tree[];
  under: Record<UnderKind, Thing[]>;
}

const MAX_TREES = 700;
/** Small things further than this from the lot's middle wouldn't be seen. */
const DETAIL = 46;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const made = new Map<string, Woods>();

/** The woods for a lot size; worked out once. */
export function woodsLayout(w: number, d: number): Woods {
  const key = `${w}:${d}`;
  let woods = made.get(key);
  if (!woods) made.set(key, (woods = makeWoods(w, d)));
  return woods;
}

function makeWoods(w: number, d: number): Woods {
  const r = rng(11);
  const cx = w / 2;
  const cz = d / 2;
  const lake = lakeShape(w);
  const camp = campLayout(d);
  const net = trailNetwork(w, d);
  const onTrail = nearTrail(net);
  const shore = shoreLayout(w, d);
  const scenes = scenesLayout(w, d);
  // the house's own trees (Lot), which nothing should crowd
  const lotTrees: [number, number][] = [[-4, 3], [-5, d - 3], [w + 4.5, 4], [w + 5, d - 2], [w * 0.3, -4.5], [w * 0.75, -5]];

  const edge = (a: number) => 25 + 3.5 * Math.sin(3 * a + 0.7) + 2 * Math.sin(7 * a + 2.1) + 1.2 * Math.sin(11 * a + 0.4);
  const polar = (x: number, z: number) => ({ a: Math.atan2(z - cz, x - cx), dist: Math.hypot(x - cx, z - cz) });

  /** Is there room here for something `m` metres across (trees ask for more room than ferns)? */
  const free = (x: number, z: number, m: number) => {
    if (x > -2 - m && x < w + 2 + m && z > -2.5 - m && z < d + 1 + m) return false; // the lot, fence and hedge
    if (z > d + 0.5 - m && z < d + 13 + m && Math.abs(x - w / 2) < STREET_REACH) return false; // pavement and street
    if (Math.abs(x - camp.cabin.x) < 3.6 + m && Math.abs(z - camp.cabin.z) < 3.6 + m) return false;
    if (Math.hypot(x - camp.fire[0], z - camp.fire[2]) < 4.5 + m) return false;
    if (x > w + 1 - m && x < w + 9.5 + m && Math.abs(z - (d / 2 + 0.5)) < 4.6 + m) return false; // the playground
    if (lake.inside(x, z, 2 + m)) return false;
    if (onTrail(x, z, 0.9 + m)) return false;
    if (net.open.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + m)) return false;
    if (shore.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.5 + m)) return false;
    if (scenes.clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.8 + m)) return false;
    if (lotTrees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.6 + m)) return false;
    return true;
  };

  // ---- trees ----
  const trees: Tree[] = [];
  const CELL = 4;
  const grid = new Map<string, Tree[]>();
  /** Crown radius, roughly: how close another tree may stand. */
  const crown = (t: Pick<Tree, "kind" | "s">) => ({ fir: 1.2, spire: 0.9, leafy: 1.5, tall: 1.1, birch: 1.0, sapling: 0.5 })[t.kind] * t.s;
  const plant = (t: Tree) => {
    if (trees.length >= MAX_TREES || !free(t.x, t.z, 1.2 + crown(t) * 0.5)) return false;
    const gx = Math.floor(t.x / CELL);
    const gz = Math.floor(t.z / CELL);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gz - 1; j <= gz + 1; j++)
        for (const o of grid.get(`${i}:${j}`) ?? []) if (Math.hypot(o.x - t.x, o.z - t.z) < (crown(o) + crown(t)) * 0.75) return false;
    trees.push(t);
    const key = `${gx}:${gz}`;
    grid.set(key, [...(grid.get(key) ?? []), t]);
    return true;
  };
  /** A kind for a tree this deep into the forest (0 at the edge, 1 far in): leafy and birch near the light. */
  const MIX: [TreeKind, number, number][] = [
    // kind, share at the edge, share deep in
    ["fir", 0.1, 0.45],
    ["spire", 0.05, 0.15],
    ["leafy", 0.35, 0.25],
    ["tall", 0.2, 0.1],
    ["birch", 0.3, 0.05],
  ];
  const kindAt = (depth: number): TreeKind => {
    let roll = r();
    for (const [kind, edgeShare, deepShare] of MIX) {
      roll -= edgeShare + (deepShare - edgeShare) * depth;
      if (roll < 0) return kind;
    }
    return "fir";
  };

  // a few lone trees out in the meadow, and young ones that have seeded just ahead of the edge
  for (let n = 0; n < 60; n++) {
    const a = r() * Math.PI * 2;
    const lone = n < 24;
    const dist = edge(a) - (lone ? 4 + r() * 6 : 0.5 + r() * 3);
    const kind: TreeKind = lone ? (["leafy", "tall", "birch", "fir"] as const)[n % 4]! : "sapling";
    plant({ x: cx + Math.cos(a) * dist, z: cz + Math.sin(a) * dist, kind, s: lone ? 1.0 + r() * 0.5 : 0.6 + r() * 0.5, h: 0.9 + r() * 0.3, tone: Math.floor(r() * 3), seed: Math.floor(r() * 1e6) });
  }
  // groves: a cluster of grown trees with young ones round the rim
  for (let g = 0; g < 80; g++) {
    const a = r() * Math.PI * 2;
    const dist = edge(a) + 1 + Math.pow(r(), 1.5) * 62;
    const gx = cx + Math.cos(a) * dist;
    const gz = cz + Math.sin(a) * dist;
    const depth = Math.min(1, (dist - edge(a)) / 40);
    const size = 3 + r() * 4;
    const count = 4 + Math.floor(r() * (6 + depth * 6));
    for (let i = 0; i < count; i++) {
      const ta = r() * Math.PI * 2;
      const tr = Math.sqrt(r()) * size;
      const rim = tr / size;
      const kind: TreeKind = rim > 0.75 && r() < 0.5 ? "sapling" : kindAt(depth);
      const s = kind === "sapling" ? 0.7 + r() * 0.5 : 0.75 + (1 - rim) * 0.55 + r() * 0.35 + depth * 0.2;
      plant({ x: gx + Math.cos(ta) * tr, z: gz + Math.sin(ta) * tr, kind, s, h: 0.85 + r() * 0.4, tone: Math.floor(r() * 3), seed: Math.floor(r() * 1e6) });
    }
  }
  // between the groves, more trees the deeper in: open at the edge, thick at the back
  for (let n = 0; n < 1400 && trees.length < MAX_TREES; n++) {
    const a = r() * Math.PI * 2;
    const dist = edge(a) + Math.pow(r(), 0.8) * 70;
    const depth = (dist - edge(a)) / 40;
    if (r() > 0.12 + depth * 0.5) continue;
    const kind = kindAt(Math.min(1, depth));
    plant({ x: cx + Math.cos(a) * dist, z: cz + Math.sin(a) * dist, kind, s: 0.8 + r() * 0.7 + Math.min(1, depth) * 0.2, h: 0.85 + r() * 0.4, tone: Math.floor(r() * 3), seed: Math.floor(r() * 1e6) });
  }
  // ---- understory, all within sight ----
  const under: Record<UnderKind, Thing[]> = { bush: [], fern: [], stump: [], log: [], branch: [], mushrooms: [] };
  const clearOfTrees = (x: number, z: number, m: number) => {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) for (const o of grid.get(`${i}:${j}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < 0.35 * o.s + m) return false;
    return true;
  };
  const taken: Thing[] = [];
  const put = (kind: UnderKind, x: number, z: number, size: number, s: number, v: number, cap: number) => {
    if (under[kind].length >= cap || Math.hypot(x - cx, z - cz) > DETAIL || !free(x, z, size * 0.5) || !clearOfTrees(x, z, size * 0.5)) return false;
    if (kind !== "mushrooms" && taken.some((t) => Math.hypot(t.x - x, t.z - z) < size * 0.5 + t.s * 0.4)) return false;
    const thing = { x, z, ry: r() * Math.PI * 2, s, v };
    under[kind].push(thing);
    if (kind !== "mushrooms" && kind !== "fern") taken.push(thing);
    return true;
  };
  /** A spot near the edge: `from` metres in front of it (negative) to `to` metres behind it. */
  const nearEdge = (from: number, to: number) => {
    const a = r() * Math.PI * 2;
    // closer to the edge more often
    const t = r() * r();
    const dist = edge(a) + (from + (to - from) * (r() < 0.5 ? t : 1 - t));
    return [cx + Math.cos(a) * dist, cz + Math.sin(a) * dist] as const;
  };

  // bushes in twos and threes along the edge, one or two straying into the meadow
  for (let n = 0; n < 140; n++) {
    const [x, z] = nearEdge(-4, 6);
    const group = 1 + Math.floor(r() * 3);
    for (let i = 0; i < group; i++) put("bush", x + (r() - 0.5) * 2.4, z + (r() - 0.5) * 2.4, 1.4, 0.75 + r() * 0.6, Math.floor(r() * 3), 150);
  }
  // ferns in drifts at the feet of trees just inside the edge
  for (const t of trees) {
    const { a, dist } = polar(t.x, t.z);
    if (dist > DETAIL || dist < edge(a) - 2 || r() > 0.45) continue;
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const fa = r() * Math.PI * 2;
      const fr = 0.6 * t.s + r() * 1.6;
      put("fern", t.x + Math.cos(fa) * fr, t.z + Math.sin(fa) * fr, 0.6, 0.7 + r() * 0.6, Math.floor(r() * 2), 320);
    }
  }
  // stumps and logs where trees have come down, each with a few mushrooms; fallen branches under the trees
  const withMushrooms = (x: number, z: number, around: number) => {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const ma = r() * Math.PI * 2;
      put("mushrooms", x + Math.cos(ma) * around, z + Math.sin(ma) * around, 0.3, 0.8 + r() * 0.5, Math.floor(r() * 2), 70);
    }
  };
  for (let n = 0; n < 60; n++) {
    const [x, z] = nearEdge(-3, 12);
    if (put("stump", x, z, 0.9, 0.8 + r() * 0.5, Math.floor(r() * 2), 26) && r() < 0.6) withMushrooms(x, z, 0.5);
  }
  for (let n = 0; n < 60; n++) {
    const [x, z] = nearEdge(-1, 12);
    if (put("log", x, z, 2.4, 0.8 + r() * 0.4, Math.floor(r() * 2), 16) && r() < 0.7) withMushrooms(x, z, 0.6);
  }
  for (let n = 0; n < 80; n++) {
    const [x, z] = nearEdge(-2, 10);
    put("branch", x, z, 1.2, 0.8 + r() * 0.5, Math.floor(r() * 2), 36);
  }
  for (let n = 0; n < 40; n++) {
    const [x, z] = nearEdge(0, 10);
    put("mushrooms", x, z, 0.3, 0.8 + r() * 0.5, Math.floor(r() * 2), 70);
  }
  return { edge, trees, under };
}
