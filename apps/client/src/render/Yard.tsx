import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "./Ambient";
import { campLayout, playLayout, SWING_ARC, SWING_DROP, SWING_RATE } from "./sceneryLayout";
import { KitMesh } from "./KitMesh";
import type { Kit } from "./kit";
import { pencilMaterial } from "./pencil";
import { dirtPath } from "./Trails";

/**
 * The two strips of grass beside the lot, outside the fence: a log cabin with a campfire circle on one side
 * (x < 0) and a little playground on the other (x > w). Decoration only, like the rest of the countryside.
 */

type V3 = [number, number, number];

/** A round post or bar between two points. */
function rod(k: Kit, mat: THREE.Material, from: V3, to: V3, diameter: number, outline = 0.008) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(diameter / 2, diameter / 2, delta.length(), 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
  k.add(g, mat, a.add(b).multiplyScalar(0.5).toArray() as V3, 1, { outline, normals: true });
}

/** A flat round patch of ground (dirt, sand) lying on the lawn. */
const PATCH = new THREE.CircleGeometry(1, 40);

/** The triangle under a gable roof: base `w` wide, `h` tall, `t` thick, standing on y = 0. */
function gable(w: number, h: number, t: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  return g;
}

export function Yard({ w, d }: { w: number; d: number }) {
  const camp = campLayout(d);
  const play = playLayout(w, d);
  return (
    <group>
      <KitMesh deps={[d]} make={(k) => campsite(k, d)} />
      <Campfire at={camp.fire} />
      {/* smoke from the cabin's chimney (its top, turned with the cabin) */}
      <Smoke at={[camp.cabin.x - 0.65, 3.95 + BASE, camp.cabin.z - (CABIN_W / 2 - 0.6)]} />
      <KitMesh deps={[w, d]} make={(k) => playground(k, w, d)} />
      {play.swings.map((s, i) => (
        <Swing key={i} at={[s.x, s.y, s.z]} phase={s.phase} />
      ))}
    </group>
  );
}

const CABIN_W = 3.6;
const CABIN_D = 3.2;
const WALL_H = 2.0;
/** The cabin stands on a low stone footing. */
const BASE = 0.22;

function campsite(k: Kit, d: number) {
  const { cabin, fire, trails } = campLayout(d);
  const logs = pencilMaterial("#a8743f", { finish: "wood" });
  const logEnds = pencilMaterial("#d9b07a");
  const roof = pencilMaterial("#8c4a36", { finish: "wood" });
  const shingle = pencilMaterial("#6e3829");
  const dark = pencilMaterial("#5e3d2a", { finish: "wood" });
  const stone = pencilMaterial("#a29e95", { finish: "stone" });
  const glow = pencilMaterial("#ffe3a3");
  const deck = pencilMaterial("#b98a5a", { finish: "wood" });
  const shutter = pencilMaterial("#5f8f5a", { finish: "paint" });
  const iron = pencilMaterial("#4a4642", { finish: "metal" });
  const W = CABIN_W;
  const D = CABIN_D;
  const H = WALL_H + BASE;

  // ---- the cabin, its door facing the fire and the house ----
  k.at([cabin.x, 0, cabin.z], Math.PI / 2, () => {
    // stone footing
    k.box(stone, [0, BASE / 2, 0], [W + 0.25, BASE, D + 0.25], { outline: 0.012 });
    const LOG = 0.25;
    for (let i = 0; i < 8; i++) {
      const y = BASE + LOG / 2 + i * LOG;
      // front and back walls run along x; the front leaves a doorway, the back and the side a window
      for (const z of [-D / 2, D / 2]) {
        const spans: [number, number][] = z > 0 && y < BASE + 1.8 ? [[-W / 2 - 0.15, 0.15], [1.05, W / 2 + 0.15]] : [[-W / 2 - 0.15, W / 2 + 0.15]];
        for (const [a, b] of spans) k.add("cyl8", logs, [(a + b) / 2, y, z], [LOG, b - a, LOG], { rot: [0, 0, Math.PI / 2], outline: 0.01 });
      }
      for (const x of [-W / 2, W / 2]) k.add("cyl8", logs, [x, y + LOG / 2, 0], [LOG, D + 0.3, LOG], { rot: [Math.PI / 2, 0, 0], outline: 0.01 });
    }
    // log ends poking out at the corners
    for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) k.add("cyl8", logEnds, [x, BASE + WALL_H / 2, z], [0.22, WALL_H, 0.22], { outline: 0.006 });

    // gables and a steep shingled roof with a ridge beam
    const RISE = 1.2;
    for (const x of [-W / 2, W / 2]) k.add(gable(D + 0.25, RISE, 0.2), logs, [x, H, 0], 1, { rot: [0, Math.PI / 2, 0], outline: 0.012 });
    const angle = Math.atan2(RISE, D / 2);
    const slope = Math.hypot(D / 2, RISE) + 0.5;
    const ridgeY = H + RISE + 0.06;
    for (const s of [-1, 1]) {
      const along = (u: number): V3 => [0, ridgeY - Math.sin(angle) * u, s * Math.cos(angle) * u];
      const c = along(slope / 2 - 0.1);
      k.box(roof, c, [W + 0.8, 0.12, slope], { rot: [s * angle, 0, 0], outline: 0.016 });
      // rows of shingles: a darker edge every so often down the slope
      for (let u = 0.45; u < slope - 0.2; u += 0.42) {
        const [x, y, z] = along(u - 0.1);
        k.box(shingle, [x, y + Math.cos(angle) * 0.07, z + s * Math.sin(angle) * 0.07], [W + 0.8, 0.035, 0.05], { rot: [s * angle, 0, 0], outline: false });
      }
    }
    k.add("cyl8", dark, [0, ridgeY + 0.04, 0], [0.18, W + 0.9, 0.18], { rot: [0, 0, Math.PI / 2], outline: 0.01 });
    // a stone chimney up the back
    k.box(stone, [W / 2 - 0.6, H + 1.05, -0.65], [0.5, 1.8, 0.5], { outline: 0.012 });
    k.box(stone, [W / 2 - 0.6, H + 2.0, -0.65], [0.6, 0.12, 0.6], { outline: 0.008 });

    // the door, in a frame, with two panels and a brass knob
    const DZ = D / 2 + 0.08;
    k.box(dark, [0.6, BASE + 0.9, DZ], [0.85, 1.78, 0.06], { outline: 0.008 });
    for (const y of [0.5, 1.3]) k.box(logs, [0.6, BASE + y, DZ + 0.035], [0.55, 0.55, 0.02], { outline: 0.004 });
    k.box(logEnds, [0.6, BASE + 1.85, DZ + 0.02], [1.05, 0.1, 0.1], { outline: 0.006 });
    for (const x of [0.12, 1.08]) k.box(logEnds, [x, BASE + 0.92, DZ + 0.02], [0.09, 1.8, 0.1], { outline: 0.006 });
    k.add("sphere", pencilMaterial("#d8b45a", { finish: "metal" }), [0.92, BASE + 0.92, DZ + 0.06], 0.055, { outline: 0.004 });

    // a warm lit window with shutters and a box of flowers under it
    const window = (x: number, z: number, ry: number) =>
      k.at([x, 0, z], ry, () => {
        const y = BASE + 1.15;
        k.box(glow, [0, y, 0.06], [0.72, 0.6, 0.03], { outline: false });
        k.box(dark, [0, y, 0.08], [0.06, 0.62, 0.04], { outline: 0.003 });
        k.box(dark, [0, y, 0.08], [0.74, 0.06, 0.04], { outline: 0.003 });
        k.box(dark, [0, y + 0.34, 0.09], [0.9, 0.07, 0.09], { outline: 0.006 });
        k.box(dark, [0, y - 0.34, 0.1], [0.9, 0.07, 0.12], { outline: 0.006 });
        for (const s of [-1, 1]) k.box(shutter, [s * 0.58, y, 0.09], [0.32, 0.72, 0.04], { rot: [0, s * 0.25, 0], outline: 0.006 });
        k.box(dark, [0, y - 0.47, 0.2], [0.8, 0.18, 0.2], { outline: 0.006 });
        const petals = ["#e5604a", "#f5c537", "#ef8fb4", "#e5604a", "#f5c537"];
        for (let i = 0; i < 5; i++) {
          k.add("sphere", pencilMaterial("#5e9a4a"), [-0.3 + i * 0.15, y - 0.33, 0.2], 0.08, { outline: false });
          k.add("sphere", pencilMaterial(petals[i]!), [-0.3 + i * 0.15, y - 0.27, 0.24], 0.055, { outline: 0.003 });
        }
      });
    window(-0.85, D / 2 + 0.08, 0);
    window(-W / 2 - 0.08, 0, -Math.PI / 2);

    // a lantern on a bracket by the door
    k.box(iron, [1.3, BASE + 1.9, DZ + 0.1], [0.04, 0.04, 0.2], { outline: 0.003 });
    k.box(glow, [1.3, BASE + 1.72, DZ + 0.2], [0.14, 0.22, 0.14], { outline: 0.006 });
    k.box(iron, [1.3, BASE + 1.86, DZ + 0.2], [0.18, 0.04, 0.18], { outline: 0.004 });

    // a porch: deck, railing at the ends, a bench by the window, a mat and a pot of flowers
    const PZ = D / 2 + 0.8;
    k.box(deck, [0, BASE - 0.04, PZ], [W + 0.5, 0.12, 1.25], { outline: 0.01 });
    k.box(deck, [0.6, 0.05, PZ + 0.8], [1.0, 0.1, 0.4], { outline: 0.008 });
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.15);
      for (const z of [PZ - 0.5, PZ + 0.55]) k.box(dark, [x, BASE + 0.45, z], [0.1, 0.9, 0.1], { outline: 0.006 });
      k.box(dark, [x, BASE + 0.85, PZ + 0.02], [0.08, 0.08, 1.15], { outline: 0.005 });
      k.box(dark, [x, BASE + 0.45, PZ + 0.02], [0.05, 0.05, 1.15], { outline: 0.004 });
    }
    k.box(deck, [-0.9, BASE + 0.42, D / 2 + 0.35], [1.1, 0.07, 0.36], { outline: 0.006 });
    for (const x of [-1.35, -0.45]) k.box(dark, [x, BASE + 0.2, D / 2 + 0.35], [0.07, 0.4, 0.3], { outline: 0.004 });
    k.box(pencilMaterial("#b8503e", { finish: "carpet" }), [0.6, BASE + 0.03, D / 2 + 0.55], [0.8, 0.02, 0.5], { outline: false });
    k.add("cone", pencilMaterial("#c87f5a"), [1.45, BASE + 0.2, PZ + 0.25], [0.32, 0.36, 0.32], { rot: [Math.PI, 0, 0], outline: 0.006 });
    k.add("blob", pencilMaterial("#5e9a4a"), [1.45, BASE + 0.5, PZ + 0.25], 0.36, { outline: 0.006 });

    // firewood stacked against the side, a chopping block with an axe in it
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 5 - row; i++) k.add("cyl8", logs, [W / 2 + 0.35, 0.12 + row * 0.2, -1.0 + i * 0.22 + row * 0.11], [0.2, 0.9, 0.2], { rot: [0, 0, Math.PI / 2], outline: 0.006 });
    k.add("cyl8", logs, [W / 2 + 0.9, 0.25, 0.8], [0.55, 0.5, 0.55], { outline: 0.01 });
    k.add("cyl8", logEnds, [W / 2 + 0.9, 0.505, 0.8], [0.5, 0.02, 0.5], { outline: false });
    rod(k, deck, [W / 2 + 0.9, 0.55, 0.8], [W / 2 + 1.25, 1.1, 0.8], 0.05, 0.004);
    k.box(iron, [W / 2 + 0.92, 0.6, 0.8], [0.18, 0.12, 0.03], { rot: [0, 0, -0.6], outline: 0.004 });
  });

  // ---- the trail: dirt with stepping stones, and little lanterns along it ----
  const flat = [pencilMaterial("#b9b4a8"), pencilMaterial("#a8a397")];
  let side = 1;
  for (const [i, pts] of trails.entries()) {
    const curve = dirtPath(k, pts, 1.0, 1 + i);
    const len = curve.getLength();
    for (let s = 0.4; s < len - 0.3; s += 0.75) {
      const p = curve.getPointAt(s / len);
      const tan = curve.getTangentAt(s / len);
      const off = ((s * 7.3) % 1) * 0.3 - 0.15;
      k.add("blob", flat[Math.floor(s * 3) % 2]!, [p.x - tan.z * off, 0.03, p.z + tan.x * off], [0.42, 0.06, 0.34], { rot: [0, s * 2.1, 0], outline: 0.005 });
    }
    for (let s = 1.5; s < len - 1; s += 3.6) {
      const p = curve.getPointAt(s / len);
      const tan = curve.getTangentAt(s / len);
      side = -side;
      const [x, z] = [p.x - tan.z * 0.85 * side, p.z + tan.x * 0.85 * side];
      k.add("cyl8", dark, [x, 0.35, z], [0.08, 0.7, 0.08], { outline: 0.005 });
      k.box(glow, [x, 0.78, z], [0.13, 0.16, 0.13], { outline: 0.005 });
      k.box(iron, [x, 0.88, z], [0.17, 0.04, 0.17], { outline: 0.004 });
    }
  }

  // ---- the fire circle ----
  const [fx, , fz] = fire;
  k.add(PATCH, pencilMaterial("#d6c095", { rim: false }), [fx, 0.006, fz], [3.3, 3.3, 1], { rot: [-Math.PI / 2, 0, 0], outline: false });
  k.add(PATCH, pencilMaterial("#5b5550", { rim: false }), [fx, 0.012, fz], [0.55, 0.55, 1], { rot: [-Math.PI / 2, 0, 0], outline: false });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.add("blob", stone, [fx + Math.cos(a) * 0.68, 0.1, fz + Math.sin(a) * 0.68], [0.32, 0.24, 0.28], { rot: [0, a, 0], outline: 0.008 });
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    k.add("cyl8", dark, [fx + Math.cos(a) * 0.18, 0.2, fz + Math.sin(a) * 0.18], [0.12, 0.6, 0.12], { rot: [0, -a, 0.9], outline: 0.006 });
  }
  // a cooking tripod with a pot hanging over the flames
  const apex: V3 = [fx, 1.75, fz];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.9;
    rod(k, iron, [fx + Math.cos(a) * 0.95, 0, fz + Math.sin(a) * 0.95], apex, 0.05, 0.004);
  }
  k.add("cyl8", iron, [fx, 1.55, fz], [0.02, 0.4, 0.02], { outline: false });
  k.add("half", iron, [fx, 1.35, fz], [0.34, 0.24, 0.34], { rot: [Math.PI, 0, 0], outline: 0.006 });
  k.add("torus", iron, [fx, 1.35, fz], [0.34, 0.34, 0.34], { rot: [Math.PI / 2, 0, 0], outline: false });

  // benches (lying logs) and stumps, round the circle but not across the trail
  const bench = (a: number) => {
    const [bx, bz] = [fx + Math.cos(a) * 2.15, fz + Math.sin(a) * 2.15];
    k.at([bx, 0, bz], -a, () => {
      k.add("cyl8", logs, [0, 0.36, 0], [0.38, 1.7, 0.38], { rot: [Math.PI / 2, 0, 0], outline: 0.012 });
      for (const z of [-0.55, 0.55]) k.box(dark, [0, 0.1, z], [0.3, 0.2, 0.14], { outline: 0.006 });
    });
    return [bx, bz] as const;
  };
  bench(0.1);
  const [gx, gz] = bench(2.75);
  const [cx2, cz2] = bench(5.1);
  for (const a of [0.85, 3.35, 4.6]) k.add("cyl8", logs, [fx + Math.cos(a) * 1.95, 0.22, fz + Math.sin(a) * 1.95], [0.5, 0.44, 0.5], { outline: 0.01 });

  // a blanket thrown over one bench
  k.at([cx2, 0, cz2], -5.1, () => {
    k.add("soft", pencilMaterial("#c9493c", { finish: "fabric" }), [0.0, 0.52, -0.2], [0.5, 0.1, 0.8], { outline: 0.006 });
    k.box(pencilMaterial("#f2e4c4", { finish: "fabric" }), [0.0, 0.58, -0.2], [0.52, 0.02, 0.06], { outline: false });
  });
  // a guitar leaning on another, and a cooler beside it
  k.at([gx, 0, gz], -2.75 + Math.PI, () => {
    k.at([0.38, 0, 0.3], 0, () => {
      // standing up against the log, face out
      const wood = pencilMaterial("#d9a066", { finish: "wood" });
      k.add("sphere", wood, [0, 0.24, 0], [0.42, 0.42, 0.13], { outline: 0.006 });
      k.add("sphere", wood, [0, 0.5, 0], [0.32, 0.32, 0.12], { outline: 0.006 });
      k.add("cyl8", dark, [0, 0.3, 0.065], [0.11, 0.01, 0.11], { rot: [Math.PI / 2, 0, 0], outline: false });
      k.box(dark, [0, 0.9, 0], [0.07, 0.62, 0.04], { outline: 0.004 });
      k.box(dark, [0, 1.27, 0], [0.1, 0.14, 0.05], { outline: 0.004 });
    });
    k.box(pencilMaterial("#3d8fa3", { finish: "paint" }), [-0.2, 0.2, 0.75], [0.55, 0.38, 0.38], { outline: 0.008 });
    k.box(pencilMaterial("#f4efe4", { finish: "paint" }), [-0.2, 0.41, 0.75], [0.58, 0.06, 0.41], { outline: 0.006 });
  });
  // marshmallow sticks leaning in from the stumps
  for (const a of [0.85, 3.35]) {
    const from: V3 = [fx + Math.cos(a) * 1.75, 0.45, fz + Math.sin(a) * 1.75];
    const tip: V3 = [fx + Math.cos(a) * 0.75, 0.75, fz + Math.sin(a) * 0.75];
    rod(k, dark, from, tip, 0.025, 0.003);
    k.add("cyl8", pencilMaterial("#fbf3e4"), tip, [0.07, 0.09, 0.07], { outline: 0.003 });
  }
  // a lantern on the third stump
  const [lx, lz] = [fx + Math.cos(4.6) * 1.95, fz + Math.sin(4.6) * 1.95];
  k.box(glow, [lx, 0.56, lz], [0.15, 0.2, 0.15], { outline: 0.006 });
  k.box(iron, [lx, 0.68, lz], [0.19, 0.04, 0.19], { outline: 0.004 });

  // a string of lights from the cabin's corner to a post by the fire
  const post: V3 = [fx + 2.2, 0, fz - 2.4];
  rod(k, dark, post, [post[0], 2.5, post[2]], 0.1);
  const from = new THREE.Vector3(cabin.x + D / 2, H + 0.1, cabin.z + W / 2);
  const to = new THREE.Vector3(post[0], 2.45, post[2]);
  for (let i = 1; i < 16; i++) {
    const t = i / 16;
    const p = from.clone().lerp(to, t);
    p.y -= Math.sin(t * Math.PI) * 0.6;
    k.add("sphere", glow, p.toArray() as V3, 0.07, { outline: 0.004 });
  }
}

/** Puffs of smoke rising from the chimney, growing and fading as they drift off. */
function Smoke({ at }: { at: V3 }) {
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  const parts = useMemo(
    () => ({
      ball: new THREE.SphereGeometry(0.22, 10, 8),
      mats: [0, 1, 2, 3, 4].map(() => new THREE.MeshBasicMaterial({ color: "#e9e6e0", transparent: true, depthWrite: false })),
    }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const p = (t * 0.18 + i / 5) % 1;
      m.position.set(p * 1.2 + Math.sin(t + i) * 0.08, p * 2.4, -p * 0.4);
      m.scale.setScalar(0.6 + p * 2.2);
      parts.mats[i]!.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, p * 1.4));
    });
  });
  return (
    <group position={at}>
      {parts.mats.map((mat, i) => (
        <mesh key={i} ref={(m) => void (puffs.current[i] = m)} geometry={parts.ball} material={mat} raycast={() => null} />
      ))}
    </group>
  );
}

/** The fire's tongues: an orange outer ring, yellow inside it, a pale core. */
const TONGUES = [
  ...[0, 1, 2, 3, 4].map((i) => ({ layer: 0, angle: (i / 5) * Math.PI * 2, ring: 0.16 })),
  ...[0, 1, 2].map((i) => ({ layer: 1, angle: (i / 3) * Math.PI * 2 + 0.5, ring: 0.08 })),
  { layer: 2, angle: 0, ring: 0 },
];

/** Flickering flames, a warm glow on the ground and sparks drifting up. */
function Campfire({ at }: { at: V3 }) {
  const flames = useRef<(THREE.Mesh | null)[]>([]);
  const sparks = useRef<(THREE.Mesh | null)[]>([]);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const parts = useMemo(
    () => ({
      // a teardrop tongue of flame, round at the bottom and drawn up to a point
      tongue: new THREE.LatheGeometry(
        [[0, 0], [0.32, 0.08], [0.5, 0.25], [0.42, 0.48], [0.22, 0.75], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)),
        12,
      ),
      disc: new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      spark: new THREE.SphereGeometry(0.03, 6, 4),
      colors: [
        new THREE.MeshBasicMaterial({ color: "#ff6a1f", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
        new THREE.MeshBasicMaterial({ color: "#ffaa30", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
        new THREE.MeshBasicMaterial({ color: "#fff2b0", transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
      ],
      sparkMat: new THREE.MeshBasicMaterial({ color: "#ffc35a", transparent: true, toneMapped: false, depthWrite: false }),
    }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    flames.current.forEach((f, i) => {
      if (!f) return;
      const { layer, angle, ring } = TONGUES[i]!;
      const size = [0.42, 0.32, 0.2][layer]!;
      const tall = [0.75, 0.62, 0.4][layer]! * (1 + 0.3 * Math.sin(t * (7 + i * 0.9) + i * 1.7) + 0.12 * Math.sin(t * 17 + i * 3));
      f.scale.set(size, tall, size);
      f.position.set(Math.cos(angle) * ring + Math.sin(t * 6 + i) * 0.02, 0.12 + layer * 0.02, Math.sin(angle) * ring);
      f.rotation.z = Math.sin(t * 4 + i * 2.3) * 0.12;
    });
    sparks.current.forEach((s, i) => {
      if (!s) return;
      const p = (t * 0.45 + i / 7) % 1;
      s.position.set(Math.sin(i * 3.1 + t) * 0.25 * p, 0.5 + p * 2, Math.cos(i * 1.7 + t * 0.8) * 0.25 * p);
      s.scale.setScalar(1 - p);
    });
    if (glow.current) glow.current.opacity = 0.32 + 0.06 * Math.sin(t * 11) + 0.04 * Math.sin(t * 23);
  });
  return (
    <group position={at}>
      {TONGUES.map((tg, i) => (
        <mesh key={i} ref={(m) => void (flames.current[i] = m)} geometry={parts.tongue} material={parts.colors[tg.layer]} renderOrder={tg.layer} raycast={() => null} />
      ))}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <mesh key={i} ref={(m) => void (sparks.current[i] = m)} geometry={parts.spark} material={parts.sparkMat} raycast={() => null} />
      ))}
      <mesh geometry={parts.disc} position={[0, 0.03, 0]} scale={1.9} raycast={() => null}>
        <meshBasicMaterial ref={glow} color="#ffb35a" transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function playground(k: Kit, w: number, d: number) {
  const { cx, cz, swings, slide, sandbox } = playLayout(w, d);
  const red = pencilMaterial("#e8613f", { finish: "paint" });
  const yellow = pencilMaterial("#f5c537", { finish: "paint" });
  const blue = pencilMaterial("#4f9fd6", { finish: "paint" });
  const green = pencilMaterial("#6fb05a", { finish: "paint" });
  const timber = pencilMaterial("#b98a5a", { finish: "wood" });
  const metal = pencilMaterial("#b9b6ae", { finish: "metal" });

  // soft bark under it all, edged with timber
  k.box(pencilMaterial("#c49a6c", { finish: "carpet", rim: false }), [cx, 0.01, cz], [7, 0.02, 7.4], { outline: false });
  for (const s of [-1, 1]) {
    k.box(timber, [cx, 0.06, cz + s * 3.7], [7.2, 0.12, 0.14], { outline: 0.008 });
    k.box(timber, [cx + s * 3.5, 0.06, cz], [0.14, 0.12, 7.4], { outline: 0.008 });
  }

  // swing frame (the swings themselves move, see Swing)
  const sx = swings[0]!.x;
  for (const z of [-1.5, 1.5]) for (const s of [-1, 1]) rod(k, red, [sx + s * 0.85, 0, cz + z], [sx, 2.3, cz + z], 0.1);
  k.add("cyl8", red, [sx, 2.3, cz], [0.1, 3.3, 0.1], { rot: [Math.PI / 2, 0, 0], outline: 0.008 });

  // a slide: a platform with a pointed roof, a ladder up one side and a blue chute down the other
  const { x: px, z: pz } = slide;
  for (const ox of [-0.45, 0.45]) for (const oz of [-0.45, 0.45]) k.box(yellow, [px + ox, 1.25, pz + oz], [0.1, 2.5, 0.1], { outline: 0.008 });
  k.box(timber, [px, 1.4, pz], [1.0, 0.08, 1.0], { outline: 0.01 });
  k.add(new THREE.ConeGeometry(0.85, 0.7, 4).rotateY(Math.PI / 4), red, [px, 2.85, pz], 1, { outline: 0.012 });
  for (const ox of [-0.45, 0.45]) k.box(yellow, [px + ox, 1.65, pz + 0.45], [0.06, 0.5, 0.06], { outline: 0.005 });
  for (const s of [-0.25, 0.25]) rod(k, metal, [px + s, 0, pz - 1.05], [px + s, 1.45, pz - 0.5], 0.05, 0.004);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    k.box(metal, [px, t * 1.45, pz - 1.05 + t * 0.55], [0.5, 0.04, 0.04], { outline: 0.003 });
  }
  const run = 2.6;
  const drop = 1.3;
  const tilt = Math.atan2(drop, run);
  const len = Math.hypot(run, drop);
  k.box(blue, [px, 1.4 - drop / 2 + 0.04, pz + 0.5 + run / 2], [0.6, 0.05, len], { rot: [tilt, 0, 0], outline: 0.008 });
  for (const s of [-0.3, 0.3]) k.box(blue, [px + s, 1.5 - drop / 2 + 0.04, pz + 0.5 + run / 2], [0.05, 0.18, len], { rot: [tilt, 0, 0], outline: 0.006 });
  k.box(blue, [px, 0.12, pz + 0.5 + run + 0.25], [0.6, 0.05, 0.5], { outline: 0.006 });

  // a sandbox with a bucket and spade
  const { x: bx, z: bz } = sandbox;
  k.box(pencilMaterial("#ead39a", { finish: "setts", rim: false }), [bx, 0.1, bz], [1.6, 0.18, 1.6], { outline: false });
  for (const s of [-1, 1]) {
    k.box(timber, [bx, 0.13, bz + s * 0.85], [1.84, 0.26, 0.12], { outline: 0.008 });
    k.box(timber, [bx + s * 0.85, 0.13, bz], [0.12, 0.26, 1.6], { outline: 0.008 });
  }
  k.add("cone", red, [bx + 0.3, 0.3, bz - 0.2], [0.22, 0.2, 0.22], { rot: [Math.PI, 0, 0], outline: 0.006 });
  k.box(yellow, [bx - 0.3, 0.23, bz + 0.25], [0.08, 0.03, 0.45], { rot: [0, 0.6, 0], outline: 0.004 });

  // a seesaw
  const ex = cx + 1.4;
  const ez = cz - 2.6;
  k.add("half", green, [ex, 0, ez], [0.5, 0.45, 0.4], { outline: 0.008 });
  k.at([ex, 0.42, ez], 0, () => {
    k.box(yellow, [0, 0, 0], [2.6, 0.07, 0.3], { rot: [0, 0, 0.16], outline: 0.008 });
    for (const s of [-1, 1]) rod(k, red, [s * 1.0, s * 0.16 + 0.03, 0], [s * 1.0 - s * 0.05, s * 0.16 + 0.35, 0], 0.04, 0.004);
  });
}

/** A swing hanging from the frame's top bar, rocking gently. */
function Swing({ at, phase }: { at: V3; phase: number }) {
  const ref = useRef<THREE.Group>(null);
  // held still with reduced motion, as the child on it is (see Folk)
  const quiet = useReducedMotion();
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = quiet ? 0 : Math.sin(clock.elapsedTime * SWING_RATE + phase) * SWING_ARC;
  });
  return (
    <group ref={ref} position={at}>
      <KitMesh
        deps={[]}
        make={(k) => {
          const chain = pencilMaterial("#9aa3a3", { finish: "metal" });
          for (const z of [-0.2, 0.2]) k.add("cyl8", chain, [0, -SWING_DROP / 2 + 0.01, z], [0.025, SWING_DROP - 0.02, 0.025], { outline: 0.003 });
          k.box(pencilMaterial("#f5c537", { finish: "paint" }), [0, -SWING_DROP, 0], [0.26, 0.05, 0.5], { outline: 0.006 });
        }}
      />
    </group>
  );
}
