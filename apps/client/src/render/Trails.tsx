import * as THREE from "three";
import { flower, grassTuft, SWAY } from "./botanicalModels";
import { KitMesh } from "./KitMesh";
import type { Kit } from "./kit";
import { pencilMaterial, type Finish } from "./pencil";
import { trailCurve, trailNetwork, type Clearing, type FlowerPatch, type Signpost } from "./trailLayout";

/**
 * The footpaths round the countryside (see trailLayout): worn dirt with a trampled verge either side, a few runs
 * of stepping stones, signposts at the junctions and patches of flowers in the bends. One kit, built once per lot
 * size; nothing here can be clicked or walked into.
 */

type V3 = [number, number, number];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Dirt colours, shared with the campsite's trails so every path reads as the same ground. */
export const DIRT = "#c8ab7c";
export const VERGE = "#a9b277";
const STONES = ["#b9b4a8", "#a8a397"];

/**
 * A flat ribbon along a curve whose two edges wander independently (so it never looks stamped out), narrowing
 * to a rounded end at each tip. Wound both ways, so it shows from above whichever way the path bends.
 */
export function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, y: number, seed: number) {
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len * 4));
  const edge = (s: number, k: number) => 0.2 * Math.sin(s * 1.3 + seed * k) + 0.12 * Math.sin(s * 3.7 + seed * 2.1 * k) + 0.06 * Math.sin(s * 8.9 + k);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = t * len;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const ends = Math.min(1, s / 0.8, (len - s) / 0.8);
    const taper = 0.35 + 0.65 * Math.sqrt(Math.max(0, ends));
    const l = (width / 2) * (1 + edge(s, 1)) * taper;
    const r = (width / 2) * (1 + edge(s, 2.3)) * taper;
    pos.push(p.x - tan.z * l, y, p.z + tan.x * l, p.x + tan.z * r, y, p.z - tan.x * r);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2, i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  return flatGeometry(pos, idx);
}

/** An uneven round patch of ground. */
export function blot(c: Clearing, y: number, seed: number) {
  const SEG = 20;
  const pos = [c.x, y, c.z];
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const r = c.r * (1 + 0.16 * Math.sin(3 * a + seed) + 0.09 * Math.sin(5 * a + seed * 2) + 0.05 * Math.sin(9 * a));
    pos.push(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
    const j = i + 1;
    const k = ((i + 1) % SEG) + 1;
    idx.push(0, j, k, 0, k, j);
  }
  return flatGeometry(pos, idx);
}

function flatGeometry(pos: number[], idx: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  return g;
}

/** A dirt path with its trampled verge: the verge a little wider and lower, so the dirt sits on it. */
export function dirtPath(k: Kit, points: [number, number][], width: number, seed: number) {
  const curve = trailCurve(points);
  k.add(ribbon(curve, width * 1.75, -0.004, seed + 5), pencilMaterial(VERGE, { rim: false }), [0, 0, 0], 1, { outline: false });
  k.add(ribbon(curve, width, 0.004, seed), pencilMaterial(DIRT, { rim: false }), [0, 0, 0], 1, { outline: false });
  return curve;
}

export function Trails({ w, d }: { w: number; d: number }) {
  return <KitMesh deps={[w, d]} make={(k) => trails(k, w, d)} />;
}

function trails(k: Kit, w: number, d: number) {
  const net = trailNetwork(w, d);
  const stone = STONES.map((c) => pencilMaterial(c));
  net.trails.forEach((t, ti) => {
    const curve = dirtPath(k, t.points, t.width, 3 + ti * 7);
    const len = curve.getLength();
    // stepping stones: a loose line of flat stones, sitting a little to one side then the other
    for (const [a, b] of t.stones) {
      for (let s = a * len, i = 0; s < b * len; s += 0.72, i++) {
        const p = curve.getPointAt(s / len);
        const tan = curve.getTangentAt(s / len);
        const off = (i % 2 ? 1 : -1) * 0.12 + Math.sin(s * 5) * 0.06;
        k.add("blob", stone[i % 2]!, [p.x - tan.z * off, 0.03, p.z + tan.x * off], [0.46 + (i % 3) * 0.06, 0.07, 0.36], { rot: [0, s * 2.3, 0], outline: 0.005 });
      }
    }
  });
  net.bare.forEach((c, i) => k.add(blot(c, 0.0, 11 + i * 3), pencilMaterial(DIRT, { rim: false }), [0, 0, 0], 1, { outline: false }));
  for (const s of net.signs) signpost(k, s);
  for (const p of net.patches) flowerPatch(k, p);
}

/** A weathered post with an arrow-shaped board for each way, its tip painted the destination's colour. */
function signpost(k: Kit, s: Signpost) {
  const post = pencilMaterial("#7a5c43", { finish: "wood" });
  const board = pencilMaterial("#e6d7b8", { finish: "wood" });
  k.box(post, [s.x, 0.72, s.z], [0.11, 1.45, 0.11], { outline: 0.008 });
  k.add(new THREE.ConeGeometry(0.1, 0.12, 4).rotateY(Math.PI / 4), post, [s.x, 1.5, s.z], 1, { outline: 0.006 });
  s.arms.forEach((arm, i) => {
    const ry = Math.atan2(-(arm.toward[1] - s.z), arm.toward[0] - s.x);
    // arms step down the post, each tipped a touch so they look nailed up by hand
    k.at([s.x, 1.26 - i * 0.2, s.z], ry, () => {
      k.add(ARROW, board, [0.06, 0, 0], 1, { rot: [0, 0, (i % 2 ? -1 : 1) * 0.04], outline: 0.006 });
      k.add(TIP, pencilMaterial(arm.tip, { finish: "paint" }), [0.06, 0, 0], 1, { rot: [0, 0, (i % 2 ? -1 : 1) * 0.04], outline: false });
    });
  });
}

/** An arrow board 0.6 long pointing along +x, and its painted point (a hair thicker so it shows on both faces). */
const ARROW = arrow(0, 0.6, 0.035);
const TIP = arrow(0.44, 0.6, 0.045);
function arrow(from: number, to: number, depth: number) {
  const s = new THREE.Shape();
  const BODY = 0.47;
  const H = 0.07;
  if (from < BODY) {
    s.moveTo(from, -H);
    s.lineTo(BODY, -H);
  } else s.moveTo(from, -H * (1 - (from - BODY) / (to - BODY)));
  s.lineTo(to, 0);
  if (from < BODY) {
    s.lineTo(BODY, H);
    s.lineTo(from, H);
  } else s.lineTo(from, H * (1 - (from - BODY) / (to - BODY)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A clump of one flower, thick in the middle and thinning out, on a low cushion of leaves with grass round it. */
function flowerPatch(k: Kit, p: FlowerPatch) {
  const r = rng(p.seed);
  const m = (tone: string, finish?: Finish) => pencilMaterial(tone, { finish, rim: false, sway: SWAY });
  const leaves = pencilMaterial("#6c9e57", { rim: false });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + r();
    const rr = p.radius * 0.35 * r();
    k.add("blob", leaves, [p.x + Math.cos(a) * rr, 0.04, p.z + Math.sin(a) * rr], [p.radius * 0.9, 0.22, p.radius * 0.75], { rot: [0, r() * 3, 0], outline: false });
  }
  for (let i = 0; i < p.count; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * p.radius;
    const at: V3 = [p.x + Math.cos(a) * rr, 0, p.z + Math.sin(a) * rr];
    // taller in the middle, so the clump reads as a mound from across the meadow
    k.at(at, r() * Math.PI * 2, () => flower(k, m, p.kind, p.tone, 0.42 + (1 - rr / p.radius) * 0.18 + r() * 0.06), 1.2 + r() * 0.3);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r();
    const rr = p.radius * (1 + r() * 0.35);
    k.at([p.x + Math.cos(a) * rr, 0, p.z + Math.sin(a) * rr], r() * 6, () => grassTuft(k, m), 0.9 + r() * 0.5);
  }
}
