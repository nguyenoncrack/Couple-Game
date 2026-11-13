import { buildNav, cellKey, findPath, walkable, type Blueprint, type Nav } from "@cg/shared";
import { lakeShape } from "../sceneryLayout";
import { shoreLayout } from "../shoreLayout";
import { nearTrail, trailNetwork } from "../trailLayout";
import { woodsLayout } from "../woodsLayout";

/**
 * Where the countryside's four-legged (and perched, and hopping) wildlife lives and what it gets up to: deer
 * grazing in the quiet clearings, rabbits in the meadow and the garden, squirrels between the trees, a fox on the
 * footpaths, a hedgehog in the garden, frogs on the lilies, sparrows on the fence. Each animal follows a loop of
 * `Beat`s (walk to a spot, stay a while doing something) that depends only on the clock, so both screens see the
 * same animal in the same place without anything being sent. Worked out from the lot's size (and, for the garden,
 * the house's own plan: garden animals only use bare lawn). Nothing here reaches the server or the house.
 */

type XZ = [number, number];

export type Species = "deer" | "buck" | "fawn" | "rabbit" | "squirrel" | "fox" | "hedgehog" | "frog" | "sparrow";
export type Act = "graze" | "sniff" | "climb" | "idle" | "preen";

/** A spot to walk to and what to do there for `stay` seconds. `y` lifts it off the ground (a fence post, a lily). */
export interface Beat {
  x: number;
  z: number;
  y?: number;
  stay: number;
  act?: Act;
}

export interface Critter {
  id: string;
  kind: Species;
  beats: Beat[];
  /** Metres a second between beats. */
  speed: number;
  /** Offset into the loop (seconds) so neighbours don't move together. */
  phase: number;
  /** How near a character can come before it's startled (metres), and where it bolts to; none: it only looks up. */
  skittish: number;
  refuge?: { x: number; y?: number; z: number };
  /** Size, relative to the model. */
  scale: number;
  /** Tidy wanderings only: it lives in the garden, so it freezes and watches rather than running off. */
  garden?: boolean;
}

/** How a patrol is going at one moment. */
export interface Stance {
  x: number;
  y: number;
  z: number;
  /** Facing (radians about y, 0 along +z) of the last walk. */
  heading: number;
  moving: boolean;
  act: Act | null;
  /** 0..1 through the current walk, or through the current stay. */
  u: number;
  /** How far round the loop it's walked, in metres (for the stride). */
  dist: number;
  /** Length of the current walk, metres. */
  leg: number;
}

interface Leg {
  from: Beat;
  to: Beat;
  start: number;
  walk: number;
  stay: number;
  len: number;
  heading: number;
  dist0: number;
}

export interface Patrol {
  cycle: number;
  legs: Leg[];
  total: number;
}

export function makePatrol(beats: Beat[], speed: number): Patrol {
  const legs: Leg[] = [];
  let t = 0;
  let dist = 0;
  beats.forEach((to, i) => {
    const from = beats[(i + beats.length - 1) % beats.length]!;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const walk = len / speed;
    legs.push({ from, to, start: t, walk, stay: to.stay, len, heading: len > 1e-6 ? Math.atan2(to.x - from.x, to.z - from.z) : 0, dist0: dist });
    t += walk + to.stay;
    dist += len;
  });
  return { cycle: Math.max(t, 1e-3), legs, total: dist };
}

/** Where a patrol has got to `seconds` into the clock (and `phase` seconds ahead). */
export function patrolAt(p: Patrol, seconds: number, phase = 0): Stance {
  const t = (((seconds + phase) % p.cycle) + p.cycle) % p.cycle;
  let leg = p.legs[p.legs.length - 1]!;
  for (const l of p.legs) {
    if (t >= l.start) leg = l;
    else break;
  }
  const into = t - leg.start;
  if (into < leg.walk) {
    const u = leg.walk > 0 ? into / leg.walk : 1;
    // ease the ends of a walk, so a start isn't a jolt
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
    return {
      x: leg.from.x + (leg.to.x - leg.from.x) * e,
      z: leg.from.z + (leg.to.z - leg.from.z) * e,
      y: (leg.from.y ?? 0) + ((leg.to.y ?? 0) - (leg.from.y ?? 0)) * e,
      heading: leg.heading,
      moving: true,
      act: null,
      u,
      dist: leg.dist0 + leg.len * e,
      leg: leg.len,
    };
  }
  return { x: leg.to.x, z: leg.to.z, y: leg.to.y ?? 0, heading: leg.heading, moving: false, act: leg.to.act ?? "idle", u: leg.stay > 0 ? Math.min(1, (into - leg.walk) / leg.stay) : 1, dist: leg.dist0 + leg.len, leg: leg.len };
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const near = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The trees whose trunks can be used (broad-leaved ones, clear of the lake and the lot's own lawn), nearest first. */
function nearestTrees(w: number, d: number, from: XZ, kinds: string[]) {
  const lake = lakeShape(w);
  return woodsLayout(w, d)
    .trees.filter((t) => kinds.includes(t.kind) && !lake.inside(t.x, t.z, 2) && !(t.x > -2 && t.x < w + 2 && t.z > -2 && t.z < d + 2))
    .map((t) => ({ t, dist: near([t.x, t.z], from) }))
    .sort((a, b) => a.dist - b.dist);
}

/** Is the straight run between two points dry land clear of the lot (and its fence)? Sampled every half metre. */
function clearRun(w: number, d: number, a: XZ, b: XZ) {
  const lake = lakeShape(w);
  const steps = Math.max(1, Math.ceil(near(a, b) / 0.5));
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / steps;
    const z = a[1] + ((b[1] - a[1]) * i) / steps;
    if (lake.inside(x, z, 1) || (x > -1 && x < w + 1 && z > -1 && z < d + 1)) return false;
  }
  return true;
}

/**
 * Somewhere to bolt to: the foot of the nearest tree that can be reached in a straight run from every spot the
 * animal uses (dry land, round the lot rather than across it), a metre toward the animal so it stops in front.
 */
function refugeFor(w: number, d: number, from: XZ | XZ[], kinds = ["leafy", "tall", "birch", "fir"]) {
  const spots = Array.isArray(from[0]) ? (from as XZ[]) : [from as XZ];
  const [mx, mz] = [spots.reduce((a, p) => a + p[0], 0) / spots.length, spots.reduce((a, p) => a + p[1], 0) / spots.length];
  for (const { t: tree } of nearestTrees(w, d, [mx, mz], kinds)) {
    const dx = mx - tree.x;
    const dz = mz - tree.z;
    const len = Math.hypot(dx, dz) || 1;
    const stop: XZ = [tree.x + (dx / len) * 1.1, tree.z + (dz / len) * 1.1];
    if (spots.every((p) => clearRun(w, d, p, stop))) return { x: stop[0], z: stop[1] };
  }
  return undefined;
}

const made = new Map<string, Critter[]>();

/** The wildlife outside the garden: the same for everyone, worked out once for a lot size. */
export function wildlifeLayout(w: number, d: number): Critter[] {
  const key = `${w}:${d}`;
  let c = made.get(key);
  if (!c) made.set(key, (c = makeOutdoors(w, d)));
  return c;
}

function makeOutdoors(w: number, d: number): Critter[] {
  const r = rng(2027);
  const net = trailNetwork(w, d);
  const woods = woodsLayout(w, d);
  const lake = lakeShape(w);
  const shore = shoreLayout(w, d);
  const out: Critter[] = [];
  const onTrail = nearTrail(net);
  const dry = (x: number, z: number, margin = 1.5) => !lake.inside(x, z, margin);
  const clear = (x: number, z: number) => dry(x, z) && !onTrail(x, z, 0.8) && !(x > -2 && x < w + 2 && z > -2 && z < d + 2);

  // deer: a doe with her fawn on the strip of meadow by the lake's east shore, and one on the quiet back lawn
  const grazing = (c: { x: number; z: number; r: number }, n: number, seed: number, off = 0): Beat[] => {
    const q = rng(seed);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + q() * 0.6 + off;
      const rr = c.r * (0.45 + q() * 0.4);
      return { x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr, stay: 7 + q() * 9, act: "graze" as Act };
    });
  };
  const [back, east] = [net.open[0]!, net.open[1]!];
  const doe = grazing(east, 4, 5);
  out.push({ id: "doe", kind: "deer", beats: doe, speed: 0.8, phase: 0, skittish: 5.5, refuge: refugeFor(w, d, doe.map((b): XZ => [b.x, b.z])), scale: 1 });
  out.push({ id: "fawn", kind: "fawn", beats: doe.map((b, i) => ({ ...b, x: b.x + 0.9, z: b.z + 0.7, stay: b.stay * 0.8 + (i % 2) })), speed: 0.9, phase: 2.5, skittish: 5, refuge: refugeFor(w, d, doe.map((b): XZ => [b.x, b.z])), scale: 0.55 });
  const buckBeats = grazing(back, 3, 9, 1.1);
  out.push({ id: "buck", kind: "buck", beats: buckBeats, speed: 0.8, phase: 11, skittish: 5, refuge: refugeFor(w, d, buckBeats.map((b): XZ => [b.x, b.z])), scale: 1.12 });

  // rabbits at the meadow's bushes, a few hops between the bush and the grass beside it
  const bushes = woods.under.bush
    .filter((b) => clear(b.x, b.z) && Math.hypot(b.x - w / 2, b.z - d / 2) < 28)
    .sort((a, b) => Math.hypot(a.x - w / 2, a.z - d / 2) - Math.hypot(b.x - w / 2, b.z - d / 2));
  const picks: typeof bushes = [];
  for (const b of bushes) if (picks.length < 3 && picks.every((p) => near([p.x, p.z], [b.x, b.z]) > 7)) picks.push(b);
  picks.forEach((b, i) => {
    const q = rng(30 + i);
    const spots: Beat[] = [0, 1, 2].map((k) => {
      const a = q() * Math.PI * 2 + k * 2;
      const rr = 1.2 + q() * 1.6;
      return { x: b.x + Math.cos(a) * rr, z: b.z + Math.sin(a) * rr, stay: 3 + q() * 6, act: "graze" as Act };
    });
    out.push({ id: `rabbit-m${i}`, kind: "rabbit", beats: spots.filter((s) => clear(s.x, s.z)).concat([{ x: b.x + 0.5, z: b.z + 0.5, stay: 5, act: "idle" }]), speed: 1.5, phase: i * 7, skittish: 3.2, refuge: { x: b.x, z: b.z }, scale: 1 });
  });

  // squirrels: ground, trunk, up the tree for a while, down again, on to the next tree
  const trees = nearestTrees(w, d, [w / 2, d / 2], ["leafy", "birch", "tall"]).filter((e) => clear(e.t.x, e.t.z)).slice(0, 12);
  const used: typeof trees = [];
  for (const e of trees) if (used.length < 4 && used.every((u) => near([u.t.x, u.t.z], [e.t.x, e.t.z]) > 6)) used.push(e);
  for (let i = 0; i + 1 < used.length && i < 4; i += 2) {
    const [a, b] = [used[i]!.t, used[i + 1]!.t];
    const trunk = (t: typeof a, ang: number): XZ => [t.x + Math.cos(ang) * 0.22 * t.s, t.z + Math.sin(ang) * 0.22 * t.s];
    const ground = (t: typeof a, ang: number): XZ => [t.x + Math.cos(ang) * 1.7, t.z + Math.sin(ang) * 1.7];
    const [ta, tb] = [trunk(a, 0.6), trunk(b, 2.4)];
    const [ga, gb] = [ground(a, 0.5), ground(b, 2.5)];
    const beats: Beat[] = [
      { x: ga[0], z: ga[1], stay: 3, act: "sniff" },
      { x: ta[0], z: ta[1], stay: 9, act: "climb" },
      { x: gb[0], z: gb[1], stay: 4, act: "sniff" },
      { x: tb[0], z: tb[1], stay: 9, act: "climb" },
    ];
    out.push({ id: `squirrel${i}`, kind: "squirrel", beats, speed: 2.2, phase: i * 5, skittish: 2.2, refuge: { x: ta[0], y: 1.9, z: ta[1] }, scale: 1 });
  }

  // a fox out along the longest footpath, a little to the side, stopping now and then to sniff
  const trail = [...net.trails].sort((a, b) => b.points.length - a.points.length)[0];
  if (trail && trail.points.length > 3) {
    const pts = trail.points;
    const beats: Beat[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[Math.min(pts.length - 1, i + 1)] ?? p;
      const side = 1.4;
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const len = Math.hypot(dx, dz) || 1;
      const x = p[0] - (dz / len) * side;
      const z = p[1] + (dx / len) * side;
      if (!dry(x, z, 1)) continue;
      beats.push({ x, z, stay: i % 3 === 1 ? 3 + r() * 3 : 0, act: "sniff" });
    }
    const loop = [...beats, ...[...beats].reverse().slice(1, -1)];
    if (loop.length > 3) out.push({ id: "fox", kind: "fox", beats: loop, speed: 1.15, phase: 3, skittish: 7, refuge: refugeFor(w, d, loop.filter((_, i) => i % 3 === 0).map((b): XZ => [b.x, b.z]), ["fir", "leafy"]), scale: 1 });
  }

  // frogs on the lily pads, hopping from one to another now and then
  shore.lilies.slice(0, 3).forEach((l, i) => {
    const other = shore.lilies[(i + 1) % shore.lilies.length]!;
    const beats: Beat[] = [
      { x: l.x, z: l.z, y: 0.07, stay: 8 + i * 3, act: "idle" },
      { x: other.x + 0.1, z: other.z + 0.1, y: 0.07, stay: 10 + i * 2, act: "idle" },
    ];
    out.push({ id: `frog${i}`, kind: "frog", beats, speed: 0.55, phase: i * 6, skittish: 1.4, scale: 1, garden: true });
  });

  // sparrows on the fence posts (the back and the sides; posts every two metres), taking off to a neighbouring post
  const o = 0.6;
  const posts: XZ[] = [];
  for (let x = -o; x <= w + o + 0.01; x += 2) posts.push([x, -o]);
  for (let z = 2 - o; z < d; z += 2) {
    posts.push([-o, z]);
    posts.push([w + o, z]);
  }
  for (let i = 0; i < 5; i++) {
    const a = posts[Math.floor(r() * posts.length)]!;
    const b = posts[Math.floor(r() * posts.length)]!;
    const c = posts[Math.floor(r() * posts.length)]!;
    out.push({
      id: `sparrow${i}`,
      kind: "sparrow",
      beats: [a, b, c].map((p) => ({ x: p[0], z: p[1], y: 0.98, stay: 9 + r() * 16, act: "preen" as Act })),
      speed: 3.2,
      phase: i * 4.3,
      skittish: 2.6,
      refuge: { x: w / 2, y: 4.5, z: -9 },
      scale: 1,
    });
  }
  return out;
}

/** The garden's bare lawn: cells with no floor, no roof and nothing standing on them, joined up by what's walkable. */
export function lawnNav(bp: Blueprint): Nav {
  const nav = buildNav(bp, 0);
  const level = bp.levels[0]!;
  const blocked = Uint8Array.from(nav.blocked);
  const { w, d } = bp.lot;
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const k = cellKey(x, z);
      if (level.tiles[k] || level.roofs[k]) blocked[z * w + x] = 1;
    }
  }
  return { ...nav, blocked };
}

/** Garden animals for this house: two rabbits and a hedgehog that wander between spots on the lawn. Empty if there's no lawn. */
export function gardenCritters(bp: Blueprint): Critter[] {
  const nav = lawnNav(bp);
  const { w, d } = bp.lot;
  const q = rng(99 + w * 7 + d);
  const free: [number, number][] = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) if (walkable(nav, x, z)) free.push([x, z]);
  if (free.length < 30) return [];
  // spots well apart from each other (the next is the free cell furthest from those picked so far, from a few tries)
  const spots: [number, number][] = [free[Math.floor(q() * free.length)]!];
  while (spots.length < 6) {
    let best = free[0]!;
    let bestD = -1;
    for (let tries = 0; tries < 24; tries++) {
      const c = free[Math.floor(q() * free.length)]!;
      const dist = Math.min(...spots.map((s) => Math.hypot(s[0] - c[0], s[1] - c[1])));
      if (dist > bestD) [best, bestD] = [c, dist];
    }
    spots.push(best);
  }
  /** Is the straight line between two cells' middles all lawn? (Sampled finely enough that no corner is clipped.) */
  const clear = (a: [number, number], b: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 0; i <= steps; i++) {
      const x = a[0] + 0.5 + ((b[0] - a[0]) * i) / steps;
      const z = a[1] + 0.5 + ((b[1] - a[1]) * i) / steps;
      for (const [ox, oz] of [[0, 0], [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]] as const) if (!walkable(nav, Math.floor(x + ox), Math.floor(z + oz))) return false;
    }
    return true;
  };
  /** A walk over the lawn from one spot to another by cell, cut down to the turns (every straight run stays on the lawn). */
  const path = (a: [number, number], b: [number, number]): [number, number][] => {
    const p = findPath(nav, a, [b]) ?? [];
    const out: [number, number][] = [];
    let at = 0;
    while (at < p.length - 1) {
      let far = at + 1;
      for (let j = p.length - 1; j > at + 1; j--) if (clear(p[at]!, p[j]!)) { far = j; break; }
      out.push([p[far]![0], p[far]![1]]);
      at = far;
    }
    return out;
  };
  const loop = (group: [number, number][], stays: [number, number], act: Act): Beat[] => {
    const beats: Beat[] = [];
    group.forEach((from, i) => {
      const to = group[(i + 1) % group.length]!;
      const route = path(from, to);
      route.forEach(([x, z], j) => beats.push({ x: x + 0.5, z: z + 0.5, stay: j === route.length - 1 ? stays[0] + q() * stays[1] : 0, act }));
    });
    return beats;
  };
  const out: Critter[] = [];
  const ra = loop([spots[0]!, spots[1]!, spots[2]!], [4, 6], "graze");
  if (ra.length > 2) out.push({ id: "rabbit-g0", kind: "rabbit", beats: ra, speed: 1.3, phase: 0, skittish: 2.4, scale: 1, garden: true });
  const rb = loop([spots[3]!, spots[4]!], [5, 6], "graze");
  if (rb.length > 2) out.push({ id: "rabbit-g1", kind: "rabbit", beats: rb, speed: 1.3, phase: 9, skittish: 2.4, scale: 1, garden: true });
  const hh = loop([spots[5]!, spots[2]!], [6, 8], "sniff");
  if (hh.length > 2) out.push({ id: "hedgehog", kind: "hedgehog", beats: hh, speed: 0.35, phase: 4, skittish: 1.8, scale: 1, garden: true });
  return out;
}

/** A fish leaping from the lake now and then (`leap`, null while it's under the water), and the ring it leaves (`ring`). */
export function fishLeap(w: number, i: number, seconds: number) {
  const lake = lakeShape(w);
  const spots: XZ[] = [[-9, -3], [6, -6], [-2, -9], [12, -2]];
  const period = 14 + i * 5.5;
  const shifted = seconds + i * 3.1;
  const n = Math.floor(shifted / period);
  const into = shifted - n * period;
  const LEAP = 0.95;
  const RING = 2.2;
  const q = rng(n * 31 + i * 7 + 1);
  const [ox, oz] = spots[(i + n) % spots.length]!;
  const angle = q() * Math.PI * 2;
  const reach = 1.3;
  const [cx, cz] = [lake.cx + ox, lake.cz + oz];
  const u = into / LEAP;
  const leap =
    into > LEAP
      ? null
      : {
          x: cx + Math.cos(angle) * (u - 0.5) * reach,
          z: cz + Math.sin(angle) * (u - 0.5) * reach,
          y: 0.04 + Math.sin(u * Math.PI) * 0.62,
          // along the way it's going (x, z) = (cos, sin) of `angle`, and 0 faces +z
          heading: Math.PI / 2 - angle,
          /** Nose-up on the way out, nose-down on the way in. */
          pitch: -Math.cos(u * Math.PI) * 1.1,
        };
  // the ring spreads from where it comes back down
  const k = (into - LEAP * 0.5) / (LEAP * 0.5 + RING);
  const ring = k >= 0 && k <= 1 ? { x: cx + Math.cos(angle) * 0.5 * reach, z: cz + Math.sin(angle) * 0.5 * reach, k } : null;
  return { leap, ring };
}

export const FISH = 3;
