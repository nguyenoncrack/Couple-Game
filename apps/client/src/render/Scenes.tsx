import * as THREE from "three";
import { KitMesh } from "./KitMesh";
import { SWAY } from "./botanicalModels";
import type { Kit } from "./kit";
import { natureMaterial } from "./nature";
import { scenesLayout, type Placed, type Scenes as Layout } from "./scenesLayout";
import { blot } from "./Trails";

/**
 * The lived-in scenes (see scenesLayout): a bicycle against the cabin wall with a flower bed, a watering can and a
 * birdhouse, a log store by the fire circle, a picnic above the lake, lanterns on shepherd's crooks, a mailbox
 * by the pavement and a ball in the playground. One kit, built once per lot size; nothing here can be clicked.
 */

type V3 = [number, number, number];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A thin bar from one point to another (frames, handles, poles). */
function bar(k: Kit, mat: THREE.Material, from: V3, to: V3, diameter: number, outline: number | false = 0.004) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(diameter / 2, diameter / 2, delta.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
  k.add(g, mat, a.add(b).multiplyScalar(0.5).toArray() as V3, 1, { outline, normals: true });
}

const TYRE = new THREE.TorusGeometry(0.31, 0.028, 6, 22);
/** Half a ring standing up: a handle or a hook. */
const ARC = new THREE.TorusGeometry(0.5, 0.06, 6, 10, Math.PI);

const FLOWERS = ["#e5604a", "#f5c537", "#ef8fb4", "#f7f1e3", "#9a7fd1"];
const WOOD = "#7a5c43";
const WICKER = "#c8a165";
const RED = "#c9493c";
const CREAM = "#f4efe4";

export function Scenes({ w, d }: { w: number; d: number }) {
  return <KitMesh deps={[w, d]} make={(k) => scenes(k, scenesLayout(w, d))} />;
}

export function scenes(k: Kit, s: Layout) {
  const put = (p: Placed, fn: () => void) => k.at([p.x, 0, p.z], p.ry, fn);
  put(s.bicycle, () => bicycle(k));
  put(s.flowerBed, () => flowerBed(k));
  put(s.wateringCan, () => wateringCan(k));
  put(s.birdhouse, () => birdhouse(k));
  put(s.woodpile, () => logStore(k));
  put(s.picnic, () => picnic(k));
  for (const l of s.lanterns) put(l, () => crookLantern(k));
  put(s.mailbox, () => mailbox(k));
  put(s.ball, () => ball(k));
}

/** A bicycle with a basket on the front, leaning back against a wall at -z, its front wheel to -x. */
function bicycle(k: Kit) {
  const paint = natureMaterial("#3d8fa3", { finish: "paint" });
  const tyre = natureMaterial("#3b3836");
  const metal = natureMaterial("#b9b6ae", { finish: "metal" });
  const dark = natureMaterial("#4a4642", { finish: "metal" });
  k.at([0, 0, 0], [-0.24, 0, 0], () => {
    const W = 0.33;
    for (const x of [-0.5, 0.5]) {
      k.add(TYRE, tyre, [x, W, 0], 1, { outline: 0.006, normals: true });
      k.add("cyl8", metal, [x, W, 0], [0.06, 0.08, 0.06], { rot: [Math.PI / 2, 0, 0], outline: false });
      for (const a of [0, Math.PI / 3, (Math.PI * 2) / 3]) k.box(metal, [x, W, 0], [0.58, 0.01, 0.01], { rot: [0, 0, a], outline: false });
    }
    // a step-through frame: chainstay, seat stays, seat tube, down tube and the fork
    const rear: V3 = [0.5, W, 0];
    const crank: V3 = [0.02, 0.3, 0];
    const seat: V3 = [0.18, 0.82, 0];
    const head: V3 = [-0.38, 0.84, 0];
    bar(k, paint, rear, crank, 0.035);
    bar(k, paint, rear, seat, 0.03);
    bar(k, paint, crank, seat, 0.04);
    bar(k, paint, crank, [-0.36, 0.7, 0], 0.045);
    bar(k, paint, [-0.5, W, 0], head, 0.035);
    // a chain guard, crank and pedals
    k.box(paint, [0.26, 0.32, 0.05], [0.5, 0.05, 0.02], { rot: [0, 0, 0.03], outline: 0.003 });
    k.add("cyl8", dark, [0.02, 0.3, 0.05], [0.16, 0.02, 0.16], { rot: [Math.PI / 2, 0, 0], outline: 0.003 });
    for (const s of [-1, 1]) k.box(dark, [0.02 + s * 0.06, 0.3 - s * 0.1, s * 0.11], [0.08, 0.02, 0.06], { outline: 0.003 });
    // the saddle, and the handlebar turned along the wall
    k.box(natureMaterial("#6e4a36"), [0.2, 0.86, 0], [0.24, 0.05, 0.12], { outline: 0.004 });
    k.at([head[0], 0.98, 0], 1.2, () => {
      bar(k, metal, [0, -0.14, 0], [0, 0, 0], 0.03);
      bar(k, metal, [0, 0, -0.24], [0, 0, 0.24], 0.025);
      for (const s of [-1, 1]) k.add("cyl8", tyre, [0, 0, s * 0.24], [0.04, 0.1, 0.04], { rot: [Math.PI / 2, 0, 0], outline: false });
    });
    // a wicker basket over the front wheel, a bunch of flowers in it
    k.box(natureMaterial(WICKER), [-0.58, 0.88, 0], [0.26, 0.2, 0.3], { outline: 0.006 });
    for (let i = 0; i < 4; i++) k.add("sphere", natureMaterial(FLOWERS[i]!), [-0.62 + (i % 2) * 0.08, 1.0, -0.08 + i * 0.05], 0.06, { outline: 0.003 });
    k.box(paint, [0.62, 0.66, 0], [0.34, 0.025, 0.14], { outline: 0.003 });
  });
}

/** A raised bed of flowers, 1.8 m along x. */
function flowerBed(k: Kit) {
  const r = rng(71);
  const plank = natureMaterial("#a8743f", { finish: "timber" });
  k.box(natureMaterial("#6b4f3a", { rim: false }), [0, 0.15, 0], [1.7, 0.04, 0.5], { outline: false });
  for (const s of [-1, 1]) {
    k.box(plank, [0, 0.09, s * 0.29], [1.84, 0.18, 0.07], { outline: 0.006 });
    k.box(plank, [s * 0.885, 0.09, 0], [0.07, 0.18, 0.5], { outline: 0.006 });
  }
  const leaves = ["#5e9a4a", "#6fa452"].map((c) => natureMaterial(c, { rim: false, sway: SWAY }));
  // low clumps of leaves in two staggered rows, each with a few flowers of one colour held up on stems
  const stem = natureMaterial("#6b7d45", { rim: false, sway: SWAY });
  for (let i = 0; i < 11; i++) {
    const x = -0.7 + i * 0.13 + (r() - 0.5) * 0.05;
    const z = (i % 2 ? 0.1 : -0.1) + (r() - 0.5) * 0.06;
    const h = 0.06 + r() * 0.08;
    k.add("blob", leaves[i % 2]!, [x, 0.17 + h / 2, z], [0.15 + r() * 0.06, h + 0.06, 0.15], { rot: [0, r() * 6, 0], outline: 0.004 });
    const petal = natureMaterial(FLOWERS[(i * 3) % FLOWERS.length]!, { sway: SWAY });
    for (let j = 0; j < 2; j++) {
      const top: V3 = [x + (r() - 0.5) * 0.12, 0.27 + h + r() * 0.14, z + (r() - 0.5) * 0.1];
      bar(k, stem, [x, 0.17, z], top, 0.012, false);
      k.add("sphere", petal, top, 0.055, { outline: 0.003 });
    }
  }
  // a pair of tall hollyhocks at one end
  for (const [x, z] of [[0.7, -0.08], [0.78, 0.1]] as const) {
    bar(k, stem, [x, 0.17, z], [x, 0.85, z], 0.025, false);
    for (let y = 0.5; y < 0.86; y += 0.1) k.add("sphere", natureMaterial("#ef8fb4", { sway: SWAY }), [x + 0.03, y, z], 0.055, { outline: 0.003 });
  }
}

/** A galvanised watering can, its spout to +x. */
function wateringCan(k: Kit) {
  const tin = natureMaterial("#8fb3a6", { finish: "metal" });
  k.add("cyl", tin, [0, 0.13, 0], [0.24, 0.26, 0.24], { outline: 0.006 });
  k.add("cyl8", tin, [0, 0.265, 0], [0.18, 0.02, 0.18], { outline: 0.003 });
  bar(k, tin, [0.1, 0.06, 0], [0.38, 0.32, 0], 0.035);
  k.add("cone", tin, [0.4, 0.34, 0], [0.08, 0.06, 0.08], { rot: [0, 0, -0.85], outline: 0.003 });
  k.add(ARC, tin, [-0.02, 0.27, 0], [0.18, 0.2, 0.3], { outline: false });
}

/** A birdhouse on a post, its door facing +z. */
function birdhouse(k: Kit) {
  const post = natureMaterial(WOOD, { finish: "timber" });
  const box = natureMaterial("#e3b866", { finish: "paint" });
  const roof = natureMaterial("#b8503e", { finish: "paint" });
  k.add("cyl8", post, [0, 0.75, 0], [0.08, 1.5, 0.08], { outline: 0.005 });
  k.box(box, [0, 1.63, 0], [0.24, 0.28, 0.22], { outline: 0.006 });
  for (const s of [-1, 1]) k.box(roof, [s * 0.09, 1.82, 0], [0.22, 0.03, 0.3], { rot: [0, 0, -s * 0.7], outline: 0.004 });
  k.add("cyl8", natureMaterial("#3b3836"), [0, 1.67, 0.111], [0.07, 0.01, 0.07], { rot: [Math.PI / 2, 0, 0], outline: false });
  k.add("cyl8", post, [0, 1.58, 0.15], [0.015, 0.08, 0.015], { rot: [Math.PI / 2, 0, 0], outline: false });
  // a little bird on the roof
  const bird = natureMaterial("#6c7f95");
  k.add("sphere", bird, [0.02, 1.95, 0.02], [0.09, 0.08, 0.13], { outline: 0.003 });
  k.add("sphere", bird, [0.02, 2.0, 0.08], 0.06, { outline: 0.003 });
  k.add("cone", natureMaterial("#e3a33a"), [0.02, 2.0, 0.12], [0.02, 0.04, 0.02], { rot: [Math.PI / 2, 0, 0], outline: false });
}

/** Split logs stacked in a little open shed, their cut ends to +z, a basket of kindling beside it. */
function logStore(k: Kit) {
  const r = rng(29);
  const logs = natureMaterial("#a8743f", { finish: "timber" });
  const ends = natureMaterial("#d9b07a");
  const frame = natureMaterial(WOOD, { finish: "timber" });
  const roof = natureMaterial("#8c4a36", { finish: "timber" });
  const L = 1.6;
  for (const s of [-1, 1]) {
    k.box(frame, [s * (L / 2 + 0.05), 0.6, -0.25], [0.08, 1.2, 0.08], { outline: 0.006 });
    k.box(frame, [s * (L / 2 + 0.05), 0.5, 0.25], [0.08, 1.0, 0.08], { outline: 0.006 });
    k.box(frame, [s * 0.5, 0.05, 0], [0.12, 0.1, 0.6], { outline: 0.005 });
  }
  k.box(roof, [0, 1.13, 0.02], [L + 0.4, 0.05, 0.8], { rot: [0.25, 0, 0], outline: 0.008 });
  for (let row = 0; row < 4; row++)
    for (let i = 0; i < 7 - (row === 3 ? 2 : 0); i++) {
      const x = -L / 2 + 0.14 + i * 0.22 + (row % 2) * 0.1 + (row === 3 ? 0.12 : 0);
      const y = 0.2 + row * 0.19;
      const len = 0.48 + r() * 0.06;
      k.add("cyl8", logs, [x, y, 0], [0.19, len, 0.19], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
      k.add("cyl8", ends, [x, y, len / 2 + 0.003], [0.16, 0.006, 0.16], { rot: [Math.PI / 2, 0, 0], outline: false });
    }
  // kindling in a basket by the end nearest the fire's path
  k.at([L / 2 + 0.45, 0, 0.3], 0, () => {
    k.add("cone", natureMaterial(WICKER), [0, 0.15, 0], [0.4, 0.3, 0.4], { rot: [Math.PI, 0, 0], outline: 0.006 });
    for (let i = 0; i < 6; i++) bar(k, logs, [(r() - 0.5) * 0.2, 0.1, (r() - 0.5) * 0.2], [(r() - 0.5) * 0.3, 0.45 + r() * 0.1, (r() - 0.5) * 0.3], 0.03, false);
  });
}

/** A gingham blanket with a basket and lunch on it, its long front edge (+z) toward the view. */
function picnic(k: Kit) {
  const r = rng(53);
  k.add(blot({ x: 0, z: 0, r: 1.35 }, 0.006, 9), natureMaterial("#a9b277", { rim: false }), [0, 0, 0], 1, { outline: false });
  const [BW, BD] = [1.8, 1.35];
  k.at([0, 0, 0], 0.08, () => {
    k.box(natureMaterial(CREAM, { rim: false }), [0, 0.012, 0], [BW, 0.012, BD], { outline: 0.006 });
    const red = natureMaterial(RED, { rim: false });
    for (let i = 0; i < 5; i++) k.box(red, [-BW / 2 + 0.18 + i * 0.36, 0.019, 0], [0.16, 0.004, BD], { outline: false });
    for (let i = 0; i < 4; i++) k.box(red, [0, 0.021, -BD / 2 + 0.17 + i * 0.335], [BW, 0.004, 0.15], { outline: false });
    // the basket at the back, one flap of its lid open
    k.at([-0.45, 0.02, -0.4], 0.15, () => {
      const wicker = natureMaterial(WICKER);
      k.box(wicker, [0, 0.13, 0], [0.52, 0.26, 0.34], { outline: 0.006 });
      k.box(natureMaterial("#a8743f"), [0, 0.27, -0.085], [0.54, 0.025, 0.18], { outline: 0.004 });
      k.box(natureMaterial("#a8743f"), [0, 0.33, 0.14], [0.54, 0.025, 0.18], { rot: [-1.0, 0, 0], outline: 0.004 });
      k.add(ARC, wicker, [0, 0.27, 0], [0.4, 0.4, 0.4], { outline: false });
      k.box(natureMaterial(RED), [0.08, 0.26, 0.06], [0.22, 0.04, 0.12], { rot: [0, 0.3, 0.2], outline: false });
    });
    // two plates, a loaf, apples, a bottle and two cups
    const plate = natureMaterial(CREAM, { finish: "paint" });
    for (const [x, z] of [[0.15, 0.25], [0.6, -0.05]] as const) {
      k.add("cyl", plate, [x, 0.03, z], [0.26, 0.015, 0.26], { outline: 0.004 });
      k.add("sphere", natureMaterial("#f5c537"), [x + 0.03, 0.05, z], [0.1, 0.04, 0.08], { outline: 0.003 });
    }
    k.add("sphere", natureMaterial("#d9a066"), [0.3, 0.06, -0.3], [0.42, 0.11, 0.13], { rot: [0, 0.5, 0], outline: 0.004 });
    for (let i = 0; i < 3; i++) k.add("sphere", natureMaterial(i ? RED : "#8fb84f"), [-0.05 + r() * 0.15, 0.06, -0.05 + i * 0.09], 0.085, { outline: 0.003 });
    const glass = natureMaterial("#7fa88a", { finish: "paint" });
    k.add("cyl8", glass, [0.72, 0.15, 0.38], [0.09, 0.26, 0.09], { outline: 0.004 });
    k.add("cyl8", glass, [0.72, 0.32, 0.38], [0.035, 0.1, 0.035], { outline: 0.003 });
    for (const [x, z] of [[0.45, 0.4], [-0.25, 0.45]] as const) k.add("cyl8", natureMaterial("#e3b866", { finish: "paint" }), [x, 0.06, z], [0.08, 0.1, 0.08], { outline: 0.003 });
    // a book left open, and a straw hat
    k.at([-0.6, 0.02, 0.35], 0.4, () => {
      for (const s of [-1, 1]) k.box(natureMaterial(CREAM), [s * 0.1, 0.01, 0], [0.2, 0.012, 0.26], { rot: [0, 0, s * 0.08], outline: 0.003 });
      k.box(natureMaterial("#4f7fa8"), [0, 0.002, 0], [0.42, 0.006, 0.28], { outline: false });
    });
    const straw = natureMaterial("#e8cf8f");
    k.add("cyl", straw, [-BW / 2 + 0.05, 0.02, 0.75], [0.5, 0.015, 0.5], { outline: 0.004 });
    k.add("half", straw, [-BW / 2 + 0.05, 0.02, 0.75], [0.26, 0.2, 0.26], { outline: 0.004 });
    k.add("cyl", natureMaterial(RED), [-BW / 2 + 0.05, 0.04, 0.75], [0.27, 0.03, 0.27], { outline: false });
  });
}

/** A lantern hanging from a shepherd's crook, its hook reaching out to +x. */
function crookLantern(k: Kit) {
  const iron = natureMaterial("#4a4642", { finish: "metal" });
  const glow = natureMaterial("#ffe3a3");
  k.add("cyl8", iron, [0, 0.8, 0], [0.04, 1.6, 0.04], { outline: 0.004 });
  k.add(ARC, iron, [0.16, 1.6, 0], [0.32, 0.32, 0.5], { outline: false });
  k.add("cyl8", iron, [0.32, 1.53, 0], [0.012, 0.14, 0.012], { outline: false });
  k.add(ARC, iron, [0.32, 1.42, 0], [0.12, 0.1, 0.3], { rot: [0, Math.PI / 2, 0], outline: false });
  k.add("cone", iron, [0.32, 1.39, 0], [0.13, 0.06, 0.13], { outline: 0.003 });
  k.box(glow, [0.32, 1.26, 0], [0.12, 0.2, 0.12], { outline: 0.004 });
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) k.box(iron, [0.32 + x * 0.06, 1.26, z * 0.06], [0.015, 0.2, 0.015], { outline: false });
  k.box(iron, [0.32, 1.15, 0], [0.15, 0.03, 0.15], { outline: 0.003 });
  // a flower at its foot
  k.add("blob", natureMaterial("#6fa452", { rim: false }), [0.08, 0.1, 0.06], [0.26, 0.2, 0.22], { outline: 0.004 });
  k.add("sphere", natureMaterial("#f7f1e3"), [0.12, 0.2, 0.1], 0.06, { outline: 0.003 });
}

/** A mailbox on a post, its door facing +z and its flag up. */
function mailbox(k: Kit) {
  const post = natureMaterial(WOOD, { finish: "timber" });
  const paint = natureMaterial("#4f7fa8", { finish: "paint" });
  k.box(post, [0, 0.5, 0], [0.09, 1.0, 0.09], { outline: 0.005 });
  k.box(post, [0, 0.98, 0], [0.18, 0.05, 0.4], { outline: 0.004 });
  k.box(paint, [0, 1.08, 0], [0.24, 0.16, 0.42], { outline: 0.006 });
  k.add("cyl", paint, [0, 1.16, 0], [0.24, 0.42, 0.24], { rot: [Math.PI / 2, 0, 0], outline: 0.006 });
  k.box(natureMaterial("#3f6a8f", { finish: "paint" }), [0, 1.12, 0.215], [0.2, 0.2, 0.01], { outline: false });
  k.add("sphere", natureMaterial("#d8b45a", { finish: "metal" }), [0, 1.18, 0.225], 0.025, { outline: false });
  // the flag, raised
  const flag = natureMaterial(RED, { finish: "paint" });
  k.box(flag, [0.13, 1.2, -0.06], [0.015, 0.3, 0.025], { outline: 0.003 });
  k.box(flag, [0.13, 1.31, -0.12], [0.015, 0.09, 0.12], { outline: 0.003 });
  // a few flowers round its foot
  const r = rng(17);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + r();
    const [x, z] = [Math.cos(a) * 0.22, Math.sin(a) * 0.22];
    k.add("blob", natureMaterial("#6fa452", { rim: false }), [x, 0.09, z], [0.24, 0.18, 0.2], { outline: 0.004 });
    k.add("sphere", natureMaterial(FLOWERS[(i + 1) % FLOWERS.length]!), [x, 0.2, z], 0.055, { outline: 0.003 });
  }
}

/** A two-tone ball. */
function ball(k: Kit) {
  k.add("sphere", natureMaterial("#e8613f", { finish: "paint" }), [0, 0.16, 0], 0.32, { outline: 0.006 });
  k.add("torus", natureMaterial(CREAM, { finish: "paint" }), [0, 0.16, 0], [0.33, 0.33, 0.6], { rot: [0.4, 0, 0.3], outline: false });
}
