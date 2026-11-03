import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { KitMesh } from "./KitMesh";
import type { Kit } from "./kit";
import { pencilMaterial } from "./pencil";

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
  const fire: V3 = [-3.6, 0, Math.min(14, d - 4)];
  const swings: V3 = [w + 6.6, 0, d / 2 + 0.5];
  return (
    <group>
      <KitMesh deps={[d]} make={(k) => campsite(k, d, fire)} />
      <Campfire at={fire} />
      <KitMesh deps={[w, d]} make={(k) => playground(k, w, d)} />
      {[-0.6, 0.6].map((z, i) => (
        <Swing key={i} at={[swings[0], 2.3, swings[2] + z]} phase={i * 2.1} />
      ))}
    </group>
  );
}

function campsite(k: Kit, d: number, fire: V3) {
  const logs = pencilMaterial("#a8743f", { finish: "wood" });
  const logEnds = pencilMaterial("#d9b07a");
  const roof = pencilMaterial("#8c4a36", { finish: "wood" });
  const dark = pencilMaterial("#5e3d2a", { finish: "wood" });
  const stone = pencilMaterial("#a29e95", { finish: "stone" });
  const glow = pencilMaterial("#ffe3a3");
  const deck = pencilMaterial("#b98a5a", { finish: "wood" });

  // a log cabin, its door facing the fire and the house
  const W = 3.4;
  const D = 3.0;
  const H = 2.0;
  k.at([-6.4, 0, Math.max(5, fire[2] - 5)], Math.PI / 2, () => {
    const LOG = 0.25;
    for (let i = 0; i < 8; i++) {
      const y = LOG / 2 + i * LOG;
      // front and back walls run along x; the front one leaves a doorway
      for (const z of [-D / 2, D / 2]) {
        const spans: [number, number][] = z > 0 && y < 1.8 ? [[-W / 2 - 0.15, 0.15], [1.05, W / 2 + 0.15]] : [[-W / 2 - 0.15, W / 2 + 0.15]];
        for (const [a, b] of spans) k.add("cyl8", logs, [(a + b) / 2, y, z], [LOG, b - a, LOG], { rot: [0, 0, Math.PI / 2], outline: 0.01 });
      }
      for (const x of [-W / 2, W / 2]) k.add("cyl8", logs, [x, y + LOG / 2, 0], [LOG, D + 0.3, LOG], { rot: [Math.PI / 2, 0, 0], outline: 0.01 });
    }
    // log ends poking out at the corners
    for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) k.add("cyl8", logEnds, [x, H / 2, z], [0.22, H, 0.22], { outline: 0.006 });
    // gables and a steep roof
    for (const x of [-W / 2, W / 2]) k.add(gable(D + 0.25, 1.1, 0.2), logs, [x, H, 0], 1, { rot: [0, Math.PI / 2, 0], outline: 0.012 });
    const angle = Math.atan2(1.1, D / 2);
    const slope = Math.hypot(D / 2, 1.1) + 0.45;
    for (const s of [-1, 1]) k.box(roof, [0, H + 1.1 - Math.sin(angle) * (slope / 2 - 0.1) + 0.06, s * Math.cos(angle) * (slope / 2 - 0.1)], [W + 0.7, 0.12, slope], { rot: [s * angle, 0, 0], outline: 0.016 });
    k.box(stone, [W / 2 - 0.6, H + 1.0, -0.65], [0.45, 1.7, 0.45], { outline: 0.012 });
    // door, a warm lit window, a lantern and a little deck
    k.box(dark, [0.6, 0.92, D / 2 + 0.08], [0.85, 1.75, 0.06], { outline: 0.008 });
    k.add("sphere", pencilMaterial("#d8b45a", { finish: "metal" }), [0.95, 0.92, D / 2 + 0.13], 0.06, { outline: 0.004 });
    k.box(glow, [-0.85, 1.15, D / 2 + 0.14], [0.75, 0.6, 0.03], { outline: false });
    k.box(dark, [-0.85, 1.15, D / 2 + 0.15], [0.85, 0.06, 0.05], { outline: 0.004 });
    k.box(dark, [-0.85, 1.15, D / 2 + 0.15], [0.06, 0.7, 0.05], { outline: 0.004 });
    k.box(dark, [-0.85, 1.48, D / 2 + 0.16], [0.95, 0.07, 0.08], { outline: 0.006 });
    k.box(dark, [-0.85, 0.82, D / 2 + 0.16], [0.95, 0.07, 0.1], { outline: 0.006 });
    k.box(glow, [1.25, 1.75, D / 2 + 0.22], [0.14, 0.2, 0.14], { outline: 0.006 });
    k.box(deck, [0, 0.07, D / 2 + 0.75], [W + 0.4, 0.14, 1.1], { outline: 0.01 });
    // firewood stacked against the side
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) k.add("cyl8", logs, [W / 2 + 0.35, 0.12 + row * 0.2, -0.6 + i * 0.22 + row * 0.11], [0.2, 0.9, 0.2], { rot: [0, 0, Math.PI / 2], outline: 0.006 });
  });

  // the fire circle: a sandy patch, a ring of stones, log benches and stumps round it
  const [fx, , fz] = fire;
  k.add(PATCH, pencilMaterial("#d6c095", { rim: false }), [fx, 0.006, fz], [3.3, 3.3, 1], { rot: [-Math.PI / 2, 0, 0], outline: false });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.add("blob", stone, [fx + Math.cos(a) * 0.62, 0.1, fz + Math.sin(a) * 0.62], [0.32, 0.22, 0.28], { rot: [0, a, 0], outline: 0.008 });
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    k.add("cyl8", dark, [fx + Math.cos(a) * 0.18, 0.2, fz + Math.sin(a) * 0.18], [0.12, 0.6, 0.12], { rot: [0, -a, 0.9], outline: 0.006 });
  }
  for (const a of [0.2, 2.2, 4.1]) {
    const [bx, bz] = [fx + Math.cos(a) * 2.1, fz + Math.sin(a) * 2.1];
    // lying logs turned along the circle, on two short stubs
    k.at([bx, 0, bz], -a, () => {
      k.add("cyl8", logs, [0, 0.36, 0], [0.38, 1.7, 0.38], { rot: [Math.PI / 2, 0, 0], outline: 0.012 });
      for (const z of [-0.55, 0.55]) k.box(dark, [0, 0.1, z], [0.3, 0.2, 0.14], { outline: 0.006 });
    });
  }
  for (const a of [1.2, 3.2, 5.2]) k.add("cyl8", logs, [fx + Math.cos(a) * 1.9, 0.22, fz + Math.sin(a) * 1.9], [0.5, 0.44, 0.5], { outline: 0.01 });
  // a string of lights from the cabin's corner to a post by the fire
  const post: V3 = [fx + 2.4, 0, fz - 2.2];
  rod(k, dark, post, [post[0], 2.4, post[2]], 0.1);
  const from = new THREE.Vector3(-4.9, 2.1, Math.max(5, fire[2] - 5) + 1.7);
  const to = new THREE.Vector3(post[0], 2.35, post[2]);
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const p = from.clone().lerp(to, t);
    p.y -= Math.sin(t * Math.PI) * 0.45;
    k.add("sphere", glow, p.toArray() as V3, 0.07, { outline: 0.004 });
  }
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
  const cx = w + 5;
  const cz = d / 2 + 0.5;
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
  const sx = cx + 1.6;
  for (const z of [-1.5, 1.5]) for (const s of [-1, 1]) rod(k, red, [sx + s * 0.85, 0, cz + z], [sx, 2.3, cz + z], 0.1);
  k.add("cyl8", red, [sx, 2.3, cz], [0.1, 3.3, 0.1], { rot: [Math.PI / 2, 0, 0], outline: 0.008 });

  // a slide: a platform with a pointed roof, a ladder up one side and a blue chute down the other
  const px = cx - 1.7;
  const pz = cz + 1.6;
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
  const bx = cx - 1.6;
  const bz = cz - 1.9;
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
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = Math.sin(clock.elapsedTime * 1.7 + phase) * 0.16;
  });
  return (
    <group ref={ref} position={at}>
      <KitMesh
        deps={[]}
        make={(k) => {
          const chain = pencilMaterial("#9aa3a3", { finish: "metal" });
          for (const z of [-0.2, 0.2]) k.add("cyl8", chain, [0, -0.88, z], [0.025, 1.76, 0.025], { outline: 0.003 });
          k.box(pencilMaterial("#f5c537", { finish: "paint" }), [0, -1.78, 0], [0.26, 0.05, 0.5], { outline: 0.006 });
        }}
      />
    </group>
  );
}
