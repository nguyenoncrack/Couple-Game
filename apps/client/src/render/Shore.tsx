import * as THREE from "three";
import { grassTuft, SWAY } from "./botanicalModels";
import { KitMesh } from "./KitMesh";
import type { Kit } from "./kit";
import { natureMaterial } from "./nature";
import { shoreLayout, type ReedBed, type ShoreLayout, type Spot } from "./shoreLayout";
import { blot } from "./Trails";

/**
 * The lake's shore (see shoreLayout): reed beds with cattails, rocks in groups, pebbly patches on the sand, water
 * lilies in the shelter of the reeds, two chairs looking out over the water, a rowboat tied up at the jetty and a
 * life ring by its foot. One kit, built once per lot size; nothing here can be clicked.
 */

type V3 = [number, number, number];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A tapering blade standing on y = 0, one metre tall (scale it). */
const BLADE = new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0);
/** A lily pad: a disc with a notch cut out, lying flat. */
const PAD = new THREE.CircleGeometry(0.5, 14, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2);
/** A petal or a flower's middle: a low sphere, since the lily flowers are small and many. */
const PETAL = new THREE.SphereGeometry(0.5, 7, 4);
/** A quarter of a life ring, so it can be painted in alternating colours. */
const RING_QUARTER = new THREE.TorusGeometry(0.24, 0.065, 8, 8, Math.PI / 2);

const ROCK = ["#9c9a92", "#b2ada2", "#8f8c84"];
const STONES = ["#b9b4a8", "#a8a397"];

export function Shore({ w, d }: { w: number; d: number }) {
  return <KitMesh deps={[w, d]} make={(k) => shore(k, shoreLayout(w, d))} />;
}

export function shore(k: Kit, s: ShoreLayout) {
  for (const bed of s.reeds) reedBed(k, s, bed);
  for (const g of s.rocks) rockGroup(k, g);
  for (const p of s.pebbles) pebblePatch(k, p);
  for (const l of s.lilies) lilyPatch(k, l);
  seating(k, s);
  dockDetails(k, s);
  rowboat(k, s);
}

/** Reeds standing in the shallows and up the bank, thickest in the middle of the bed, a few of them cattails. */
function reedBed(k: Kit, s: ShoreLayout, bed: ReedBed) {
  const r = rng(bed.seed);
  // tall, so a little sway goes a long way at their tips
  const greens = ["#6f8f4a", "#7f9a52", "#5d7f40"].map((c) => natureMaterial(c, { rim: false, sway: 0.06 }));
  const stem = natureMaterial("#6b7d45", { rim: false, sway: 0.06 });
  const head = natureMaterial("#7a4f2e", { sway: 0.06 });
  for (let i = 0; i < bed.count; i++) {
    // gathered toward the middle of the bed: the sum of two randoms leans to the centre
    const a = bed.a + (r() + r() - 1) * bed.spread;
    const [x, z] = s.edge(a, -1.0 + r() * 2.0);
    const middle = 1 - Math.abs(a - bed.a) / bed.spread;
    const h = 0.7 + middle * 0.6 + r() * 0.4;
    const lean: V3 = [(r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3];
    if (i % 4 === 0) {
      // a cattail: a straight stem, its brown head a little below the tip
      k.add("cyl8", stem, [x, h / 2, z], [0.022, h, 0.022], { rot: lean, outline: false });
      const tilt = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(lean[0], lean[1], lean[2], "YXZ"));
      const at = (t: number): V3 => [x + tilt.x * h * t, tilt.y * h * t, z + tilt.z * h * t];
      k.add("cyl8", head, at(0.82), [0.075, 0.22, 0.075], { rot: lean, outline: 0.004 });
      k.add("cyl8", stem, at(1.02), [0.012, 0.12, 0.012], { rot: lean, outline: false });
    } else {
      k.add(BLADE, greens[i % 3]!, [x, 0, z], [0.065, h, 0.05], { rot: lean, outline: false });
    }
  }
  // broad leaves round its foot on the bank
  for (let i = 0; i < 5; i++) {
    const a = bed.a + (r() - 0.5) * bed.spread * 1.6;
    const [x, z] = s.edge(a, 0.6 + r() * 0.8);
    k.at([x, 0, z], r() * 6, () => grassTuft(k, (tone) => natureMaterial(tone, { rim: false, sway: SWAY })), 1.4 + r() * 0.6);
  }
}

/** One big rock with a few smaller ones huddled round it, all sunk a little into the ground; big ones get moss. */
function rockGroup(k: Kit, g: Spot) {
  const r = rng(g.seed);
  const moss = natureMaterial("#7f9a5a", { rim: false });
  const big = g.r;
  k.add("blob", natureMaterial(ROCK[0]!, { finish: "mineral" }), [g.x, big * 0.18, g.z], [big, big * 0.62, big * 0.82], { rot: [0, r() * 6, 0], outline: 0.014 });
  if (big > 1.1) k.add("blob", moss, [g.x - big * 0.08, big * 0.44, g.z + big * 0.05], [big * 0.55, big * 0.16, big * 0.45], { rot: [0, r() * 6, 0], outline: false });
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const dist = big * (0.6 + r() * 0.45);
    const size = big * (0.22 + r() * 0.3);
    k.add("blob", natureMaterial(ROCK[1 + (i % 2)]!, { finish: "mineral" }), [g.x + Math.cos(a) * dist, size * 0.15, g.z + Math.sin(a) * dist], [size, size * 0.6, size * 0.85], { rot: [0, r() * 6, 0], outline: 0.008 });
  }
}

/** A drift of pebbles on a patch of coarser, greyer sand. */
function pebblePatch(k: Kit, p: Spot) {
  const r = rng(p.seed);
  k.add(blot({ x: p.x, z: p.z, r: p.r }, 0.016, p.seed), natureMaterial("#c2b9a0", { rim: false }), [0, 0, 0], 1, { outline: false });
  const tones = [...ROCK, "#c9c2b2"].map((c) => natureMaterial(c, { finish: "mineral" }));
  for (let i = 0; i < 24; i++) {
    const a = r() * Math.PI * 2;
    const dist = Math.sqrt(r()) * p.r * 0.95;
    const size = 0.07 + r() * 0.12;
    k.add("blob", tones[i % 4]!, [p.x + Math.cos(a) * dist, 0.025, p.z + Math.sin(a) * dist], [size, size * 0.5, size * 0.8], { rot: [0, r() * 6, 0], outline: 0.004 });
  }
}

/** Lily pads floating in a loose cluster, a few of them flowering. */
function lilyPatch(k: Kit, l: Spot) {
  const r = rng(l.seed);
  const pads = ["#6f9a52", "#82ab5f"].map((c) => natureMaterial(c, { rim: false }));
  const n = Math.round(4 + l.r * 4);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const dist = Math.sqrt(r()) * l.r;
    const x = l.x + Math.cos(a) * dist;
    const z = l.z + Math.sin(a) * dist;
    const size = 0.32 + r() * 0.28;
    k.add(PAD, pads[i % 2]!, [x, 0.042 + i * 0.0005, z], [size, 1, size], { rot: [0, r() * 6, 0], outline: false });
    if (i % 3 === 0) {
      const petals = natureMaterial(i % 2 ? "#f7f1e3" : "#f2b8c6", { rim: false });
      for (let p = 0; p < 7; p++) {
        const pa = (p / 7) * Math.PI * 2;
        k.add(PETAL, petals, [x + Math.cos(pa) * 0.05, 0.07, z + Math.sin(pa) * 0.05], [0.09, 0.04, 0.045], { rot: [0, -pa, 0.35], outline: false });
      }
      k.add(PETAL, natureMaterial("#f2cc72", { rim: false }), [x, 0.08, z], 0.045, { outline: false });
    }
  }
}

/** Two painted chairs angled toward each other, a stump between them with a mug on it, stones in from the trail. */
function seating(k: Kit, s: ShoreLayout) {
  const { x, z, facing, stones } = s.seat;
  k.add(blot({ x, z, r: 1.35 }, 0.014, 5), natureMaterial("#d3c294", { rim: false }), [0, 0, 0], 1, { outline: false });
  const stone = STONES.map((c) => natureMaterial(c));
  stones.forEach(([sx, sz], i) => k.add("blob", stone[i % 2]!, [sx, 0.03, sz], [0.46 + (i % 3) * 0.06, 0.07, 0.36], { rot: [0, i * 2.3, 0], outline: 0.005 }));
  // turn so local +z looks along `facing`
  k.at([x, 0, z], Math.PI / 2 - facing, () => {
    chair(k, [-0.62, 0, 0], 0.22, "#8fb3a6");
    chair(k, [0.62, 0, 0], -0.22, "#e3b866");
    const logs = natureMaterial("#a8743f", { finish: "timber" });
    k.add("cyl8", logs, [0, 0.2, 0.18], [0.42, 0.4, 0.42], { outline: 0.008 });
    k.add("cyl8", natureMaterial("#d9b07a"), [0, 0.405, 0.18], [0.38, 0.01, 0.38], { outline: false });
    const mug = natureMaterial("#e9e2d2", { finish: "paint" });
    k.add("cyl8", mug, [0.06, 0.46, 0.14], [0.08, 0.1, 0.08], { outline: 0.003 });
    k.add("torus", mug, [0.11, 0.46, 0.14], [0.05, 0.05, 0.05], { outline: false });
  });
}

/** A low wooden lounging chair, its seat sloping back and its back fanned, facing local +z. */
function chair(k: Kit, at: V3, turn: number, tone: string) {
  const paint = natureMaterial(tone, { finish: "paint" });
  k.at(at, turn, () => {
    for (const sx of [-0.3, 0.3]) {
      k.box(paint, [sx, 0.2, 0.02], [0.05, 0.12, 0.8], { rot: [0.25, 0, 0], outline: 0.004 });
      k.box(paint, [sx * 1.15, 0.27, 0.3], [0.06, 0.54, 0.06], { outline: 0.004 });
      k.box(paint, [sx * 1.15, 0.55, 0.06], [0.13, 0.03, 0.66], { outline: 0.004 });
    }
    for (let i = 0; i < 4; i++) k.box(paint, [0, 0.36 - i * 0.03, 0.26 - i * 0.14], [0.6, 0.03, 0.12], { rot: [0.2, 0, 0], outline: 0.003 });
    for (let i = -2; i <= 2; i++) k.box(paint, [i * 0.115, 0.68, -0.32], [0.1, 0.78, 0.025], { rot: [-0.38, 0, -i * 0.04], outline: 0.003 });
    k.box(paint, [0, 0.62, -0.28], [0.62, 0.05, 0.03], { rot: [-0.38, 0, 0], outline: 0.003 });
  });
}

/** A rope from `a` to `b`, sagging in the middle, as a few short rods. */
function rope(k: Kit, mat: THREE.Material, a: V3, b: V3, sag: number) {
  const SEG = 8;
  const pt = (t: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (b[2] - a[2]) * t);
  for (let i = 0; i < SEG; i++) {
    const p = pt(i / SEG);
    const q = pt((i + 1) / SEG);
    const along = q.clone().sub(p);
    const g = new THREE.CylinderGeometry(0.018, 0.018, along.length() + 0.01, 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
    k.add(g, mat, p.add(q).multiplyScalar(0.5).toArray() as V3, 1, { outline: false });
  }
}

const ROPE = "#d9c08f";
/** The jetty's posts: two rows (x = ±0.68 from its middle), from the shore end out every 1.75 m. */
const postZ = (s: ShoreLayout, i: number) => s.dock.shoreZ + 0.4 - i * 1.75;

function dockDetails(k: Kit, s: ShoreLayout) {
  const { x } = s.dock;
  const ropeMat = natureMaterial(ROPE);
  const post = natureMaterial("#7a5c43", { finish: "timber" });
  // a life ring hung on its own post at the foot of the jetty, facing the path
  const lx = x - 0.98;
  const lz = s.dock.shoreZ + 0.75;
  k.add("cyl8", post, [lx, 0.62, lz], [0.12, 1.24, 0.12], { outline: 0.008 });
  k.box(post, [lx, 1.06, lz + 0.07], [0.04, 0.04, 0.1], { outline: 0.003 });
  const tones = ["#e05a43", "#f4efe4"].map((c) => natureMaterial(c, { finish: "paint" }));
  for (let q = 0; q < 4; q++) k.add(RING_QUARTER, tones[q % 2]!, [lx, 0.82, lz + 0.11], 1, { rot: [0, 0, (q * Math.PI) / 2 + Math.PI / 4], outline: 0.005 });
  // a coil of rope on the boards near the end, and a turn of rope round the far post
  for (let i = 0; i < 2; i++) k.add("torus", ropeMat, [x + 0.3, 0.475 + i * 0.03, postZ(s, 4) + 0.6], [0.32 - i * 0.06, 0.32 - i * 0.06, 0.5], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
  for (let i = 0; i < 2; i++) k.add("torus", ropeMat, [x - 0.68, 0.55 + i * 0.05, postZ(s, 4)], [0.15, 0.15, 0.25], { rot: [Math.PI / 2, 0, 0], outline: false });
}

/** A little rowboat moored alongside the jetty, oars shipped, its bow line tied to a post. */
function rowboat(k: Kit, s: ShoreLayout) {
  const { x, z, ry } = s.boat;
  const L = 2.7;
  const D = 0.36;
  const hullPaint = natureMaterial("#f1e9da", { finish: "paint" });
  const rail = natureMaterial("#c9493c", { finish: "paint" });
  const wood = natureMaterial("#b98a5a", { finish: "timber" });
  const dark = natureMaterial("#7a5c43", { finish: "timber" });
  k.at([x, -0.05, z], ry, () => {
    k.add(HULL, hullPaint, [0, 0, 0], 1, { outline: 0.008, normals: true });
    // floorboards, two thwarts, a gunwale rail along each side
    k.box(wood, [0, 0.06, -0.1], [0.5, 0.03, 1.7], { outline: 0.004 });
    for (const tz of [-0.55, 0.35]) k.box(wood, [0, D - 0.08, tz], [halfBeam(tz) * 2 - 0.04, 0.04, 0.2], { outline: 0.004 });
    for (let i = 0; i < GUNWALE.length - 1; i++) {
      const [ax, ay, az] = GUNWALE[i]!;
      const [bx, by, bz] = GUNWALE[i + 1]!;
      for (const side of [-1, 1]) {
        const a = new THREE.Vector3(ax * side, ay + 0.02, az);
        const b = new THREE.Vector3(bx * side, by + 0.02, bz);
        const along = b.clone().sub(a);
        const g = new THREE.CylinderGeometry(0.03, 0.03, along.length() + 0.02, 6);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
        k.add(g, rail, a.add(b).multiplyScalar(0.5).toArray() as V3, 1, { outline: 0.004, normals: true });
      }
    }
    // oars lying along the thwarts, blades toward the stern
    for (const side of [-1, 1]) {
      k.add("cyl8", dark, [side * 0.16, D - 0.04, -0.15], [0.04, 2.2, 0.04], { rot: [Math.PI / 2, side * 0.06, 0], outline: 0.003 });
      k.box(dark, [side * 0.16 - side * 0.065, D - 0.04, -1.15], [0.14, 0.02, 0.4], { rot: [0, side * 0.06, 0], outline: 0.003 });
    }
  });
  // the bow line, from the stem to the jetty's nearest post
  const bow = new THREE.Vector3(0, D + 0.08, L / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(new THREE.Vector3(x, -0.05, z));
  const tie: V3 = [s.dock.x + 0.68, 0.6, postZ(s, 1)];
  rope(k, natureMaterial(ROPE), [bow.x, bow.y, bow.z], tie, 0.18);
  k.add("torus", natureMaterial(ROPE), tie, [0.13, 0.13, 0.25], { rot: [Math.PI / 2, 0, 0], outline: false });
}

/** Half the boat's width at the top, along its length (z from the stern at -L/2 to the bow at +L/2). */
function halfBeam(z: number) {
  const t = z / 2.7 + 0.5;
  return 0.56 * (t < 0.42 ? 1 - 0.28 * ((0.42 - t) / 0.42) ** 2 : 1 - ((t - 0.42) / 0.58) ** 2);
}

/** The hull's top edge (one side, x ≥ 0), stern to bow; the bow sweeps up a little. */
const GUNWALE: V3[] = Array.from({ length: 13 }, (_, i) => {
  const t = i / 12;
  const z = -1.35 + t * 2.7;
  return [halfBeam(z), 0.36 + 0.12 * t ** 3, z] as V3;
});

/**
 * An open hull lofted between its top edge and a narrower, shorter flat bottom, with a square transom at the
 * stern. Every face is there both ways round, so the inside shows as well as the outside.
 */
const HULL = (() => {
  const top = GUNWALE;
  const bottom = top.map(([hx, , z], i) => [hx * 0.6, 0, z * 0.86 + (i === 0 ? 0.04 : 0)] as V3);
  const tris: V3[][] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3) => tris.push([a, b, c], [a, c, d]);
  const flip = (p: V3, side: number): V3 => [p[0] * side, p[1], p[2]];
  for (let i = 0; i < top.length - 1; i++) {
    for (const side of [-1, 1]) quad(flip(top[i]!, side), flip(top[i + 1]!, side), flip(bottom[i + 1]!, side), flip(bottom[i]!, side));
    quad(flip(bottom[i]!, -1), flip(bottom[i + 1]!, -1), bottom[i + 1]!, bottom[i]!);
  }
  quad(flip(top[0]!, -1), top[0]!, bottom[0]!, flip(bottom[0]!, -1));
  const pos: number[] = [];
  for (const [a, b, c] of tris) pos.push(...a!, ...b!, ...c!, ...a!, ...c!, ...b!);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
})();
