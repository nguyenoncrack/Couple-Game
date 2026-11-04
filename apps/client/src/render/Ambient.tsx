import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ambientLayout, LEAF_DRIFT, LEAVES, type Flock, type LeafTree, type Ripple } from "./ambientLayout";
import { lighting, pencilMaterial, WIND } from "./pencil";

/**
 * The countryside's small life (see ambientLayout): butterflies over the flowers, birds wheeling over the lake
 * and the meadow, leaves twirling down from the trees and rings spreading on the water. A few instanced meshes
 * moved each frame on this machine only: nothing is saved, synced or clickable. People who ask their system for
 * less motion get none of it, and the grass and reeds stand still for them too.
 */

type XZ = [number, number];

export function useReducedMotion() {
  return useSyncExternalStore(
    (l) => {
      const q = window.matchMedia("(prefers-reduced-motion: reduce)");
      q.addEventListener("change", l);
      return () => q.removeEventListener("change", l);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

export function Ambient({ w, d }: { w: number; d: number }) {
  const still = useReducedMotion();
  useEffect(() => {
    lighting.wind.value = still ? 0 : 1;
  }, [still]);
  const a = useMemo(() => ambientLayout(w, d), [w, d]);
  if (still) return null;
  return (
    <group name="ambient">
      <Butterflies homes={a.butterflies} />
      <Birds flocks={a.flocks} />
      <Leaves trees={a.leafTrees} />
      <Ripples ripples={a.ripples} />
    </group>
  );
}

/** Flat shapes lying in the xz plane, made two-sided so they show from above and below. */
function twoSided(parts: THREE.BufferGeometry[]) {
  const all = parts.flatMap((g) => {
    const back = g.clone();
    // flip the winding so the copy faces down
    const index = back.index!.array as Uint16Array;
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2]!, index[i + 1]!];
    back.attributes.normal!.array.forEach((_, i, arr) => ((arr as Float32Array)[i] = -arr[i]!));
    return [g, back];
  });
  return mergeGeometries(all)!;
}

/** A butterfly's wing, reaching out along +x: a broad forewing ahead (+z) and a smaller hindwing behind. */
const WING = twoSided(
  [
    [0.05, 0.022, 0.045],
    [0.038, -0.028, 0.032],
  ].map(([x, z, r]) => new THREE.CircleGeometry(r!, 9).rotateX(-Math.PI / 2).translate(x!, 0, z!)),
);
const BODY = new THREE.CylinderGeometry(0.009, 0.006, 0.075, 5).rotateX(Math.PI / 2);
const BUTTERFLY_TONES = ["#f7f1e3", "#f5c537", "#e8913f", "#8fb0dc"];

/** Bounding volumes don't follow instances about, so these are never culled; they're tiny. */
function InstancedSet({ geometry, material, count, set }: { geometry: THREE.BufferGeometry; material: THREE.Material; count: number; set: (m: THREE.InstancedMesh | null) => void }) {
  // a ref callback mustn't return anything (React would take it for a cleanup)
  return <instancedMesh ref={(m) => void set(m)} args={[geometry, material, count]} frustumCulled={false} raycast={() => null} dispose={null} />;
}

const o = new THREE.Object3D();
const base = new THREE.Matrix4();
const local = new THREE.Matrix4();
const out = new THREE.Matrix4();
const flapQ = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3(0, 0, 0);
const NONE = new THREE.Matrix4().makeScale(0, 0, 0);

/** Set a left and a right wing from a body's matrix, raised `flap` radians above level. */
function wings(mesh: THREE.InstancedMesh, i: number, body: THREE.Matrix4, flap: number) {
  for (const [j, angle] of [[0, flap], [1, Math.PI - flap]] as const) {
    local.compose(ZERO, flapQ.setFromAxisAngle(Z, angle), ONE);
    mesh.setMatrixAt(i * 2 + j, out.multiplyMatrices(body, local));
  }
}

/** Beyond this, a butterfly or a leaf is too small to see, so it's left out. */
const NEAR = 45;

function Butterflies({ homes }: { homes: XZ[] }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const bodies = useRef<THREE.InstancedMesh | null>(null);
  const materials = useMemo(() => BUTTERFLY_TONES.map((c) => pencilMaterial(c, { rim: false })), []);
  const counts = BUTTERFLY_TONES.map((_, c) => homes.filter((_, i) => i % BUTTERFLY_TONES.length === c).length);
  const at = (i: number, t: number, v: THREE.Vector3) => {
    const [hx, hz] = homes[i]!;
    const p = i * 1.37;
    // a loose figure of eight round its flowers, bobbing, with now and then a dip down to them
    return v.set(
      hx + Math.sin(t * 0.53 + p) * 1.2 + Math.sin(t * 1.31 + p * 2) * 0.35,
      0.62 + 0.22 * Math.sin(t * 0.7 + p) + 0.07 * Math.sin(t * 3.3 + p),
      hz + Math.cos(t * 0.41 + p) * 1.1 + Math.sin(t * 1.17 + p) * 0.3,
    );
  };
  const here = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    homes.forEach((_, i) => {
      const colour = i % BUTTERFLY_TONES.length;
      const j = Math.floor(i / BUTTERFLY_TONES.length);
      const mesh = meshes.current[colour];
      if (!mesh || !bodies.current) return;
      at(i, t, here);
      if (camera.position.distanceTo(here) > NEAR) {
        bodies.current.setMatrixAt(i, NONE);
        mesh.setMatrixAt(j * 2, NONE);
        mesh.setMatrixAt(j * 2 + 1, NONE);
        return;
      }
      at(i, t + 0.08, ahead);
      o.position.copy(here);
      o.rotation.set(0, Math.atan2(ahead.x - here.x, ahead.z - here.z), 0);
      // a little larger than life, so they read from the usual camera height
      o.scale.setScalar(1.6);
      o.updateMatrix();
      base.copy(o.matrix);
      bodies.current.setMatrixAt(i, base);
      wings(mesh, j, base, 0.2 + 1.15 * Math.abs(Math.sin(t * 13 + i * 2.1)));
    });
    for (const m of [...meshes.current, bodies.current]) if (m) m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      {materials.map((m, c) => (
        <InstancedSet key={c} geometry={WING} material={m} count={counts[c]! * 2} set={(mesh) => (meshes.current[c] = mesh)} />
      ))}
      <InstancedSet geometry={BODY} material={pencilMaterial("#3a3631")} count={homes.length} set={(mesh) => (bodies.current = mesh)} />
    </>
  );
}

/** A bird's wing, out along +x and swept back a little. */
const BIRD_WING = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.07);
  s.lineTo(0.2, 0.05);
  s.lineTo(0.38, -0.05);
  s.lineTo(0.22, -0.02);
  s.lineTo(0, -0.06);
  s.closePath();
  return twoSided([new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2)]);
})();
const BIRD_BODY = new THREE.SphereGeometry(0.5, 7, 5).scale(0.08, 0.07, 0.24);

function Birds({ flocks }: { flocks: Flock[] }) {
  const all = useMemo(() => flocks.flatMap((f, fi) => Array.from({ length: f.birds }, (_, i) => ({ f, i, seed: fi * 7 + i }))), [flocks]);
  const wingsRef = useRef<THREE.InstancedMesh | null>(null);
  const bodies = useRef<THREE.InstancedMesh | null>(null);
  const here = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  const at = ({ f, i, seed }: (typeof all)[number], t: number, v: THREE.Vector3) => {
    // following one another round the circle, each a little in or out of it and rising and falling
    const a = t * f.speed * Math.PI * 2 + i * 0.32 * Math.sign(f.speed);
    const r = f.r + Math.sin(t * 0.21 + seed) * 1.2 + (i % 2) * 0.8;
    return v.set(f.x + Math.cos(a) * r, f.y + Math.sin(t * 0.37 + seed) * 0.7 + i * 0.25, f.z + Math.sin(a) * r);
  };
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!wingsRef.current || !bodies.current) return;
    all.forEach((b, n) => {
      at(b, t, here);
      at(b, t + 0.1, ahead);
      o.position.copy(here);
      // banked into the turn
      o.rotation.set(0, Math.atan2(ahead.x - here.x, ahead.z - here.z), -0.25 * Math.sign(b.f.speed), "YXZ");
      o.scale.setScalar(1.4);
      o.updateMatrix();
      bodies.current!.setMatrixAt(n, o.matrix);
      // stretches of gliding between bursts of flapping
      const flapping = THREE.MathUtils.clamp((0.25 - Math.sin(t * 0.35 + b.seed * 1.7)) * 3, 0, 1);
      wings(wingsRef.current!, n, o.matrix, 0.12 + flapping * 0.55 * Math.sin(t * 9 + b.seed));
    });
    wingsRef.current.instanceMatrix.needsUpdate = true;
    bodies.current.instanceMatrix.needsUpdate = true;
  });
  const ink = pencilMaterial("#55504a", { rim: false });
  return (
    <>
      <InstancedSet geometry={BIRD_WING} material={ink} count={all.length * 2} set={(m) => (wingsRef.current = m)} />
      <InstancedSet geometry={BIRD_BODY} material={ink} count={all.length} set={(m) => (bodies.current = m)} />
    </>
  );
}

const LEAF = twoSided([new THREE.CircleGeometry(0.5, 8).rotateX(-Math.PI / 2).scale(0.16, 1, 0.1)]);
const LEAF_TONES = ["#d9a441", "#c8692f", "#9bb35a"];

/** A number from 0 to 1 that's always the same for the same two. */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function Leaves({ trees }: { trees: LeafTree[] }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const per = Math.ceil(LEAVES / LEAF_TONES.length);
  const here = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera }) => {
    if (!trees.length) return;
    const t = clock.elapsedTime;
    for (let n = 0; n < LEAVES; n++) {
      const mesh = meshes.current[n % LEAF_TONES.length];
      if (!mesh) continue;
      const slot = Math.floor(n / LEAF_TONES.length);
      // each leaf lives a cycle: let go from a crown, twirl down drifting downwind, lie a while, then fade
      const period = 11 + (n % 5) * 1.3;
      const cycle = t / period + n * 0.37;
      const u = cycle - Math.floor(cycle);
      const round = Math.floor(cycle);
      const tree = trees[Math.floor(hash(n, round) * trees.length)]!;
      const a = hash(round, n) * Math.PI * 2;
      const sx = tree.x + Math.cos(a) * tree.spread * 0.8;
      const sz = tree.z + Math.sin(a) * tree.spread * 0.8;
      const fall = Math.min(1, u / 0.7);
      const spin = fall * 11 + n;
      const loose = 0.35 * (1 - fall * 0.4);
      here.set(
        sx + WIND[0] * LEAF_DRIFT * fall + Math.sin(spin) * loose,
        u < 0.7 ? tree.y * (1 - fall) + 0.02 : 0.02,
        sz + WIND[1] * LEAF_DRIFT * fall + Math.cos(spin) * loose,
      );
      if (camera.position.distanceTo(here) > NEAR) {
        mesh.setMatrixAt(slot, NONE);
        continue;
      }
      o.position.copy(here);
      if (u < 0.7) o.rotation.set(Math.sin(spin * 0.8) * 0.9, spin * 0.6, Math.cos(spin * 1.3) * 0.7);
      else o.rotation.set(0, n, 0);
      o.scale.setScalar(Math.min(1, u * 30) * (u > 0.92 ? (1 - u) / 0.08 : 1));
      o.updateMatrix();
      mesh.setMatrixAt(slot, o.matrix);
    }
    for (const m of meshes.current) if (m) m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      {LEAF_TONES.map((c, i) => (
        <InstancedSet key={c} geometry={LEAF} material={pencilMaterial(c, { rim: false })} count={per} set={(m) => (meshes.current[i] = m)} />
      ))}
    </>
  );
}

/** Two thin concentric rings lying on the water, a metre across at their widest (scaled per ripple). */
const RINGS = mergeGeometries([new THREE.RingGeometry(0.88, 1, 32), new THREE.RingGeometry(0.52, 0.6, 24)])!.rotateX(-Math.PI / 2);

const rippleMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    attribute vec3 aRipple; // widest radius, seconds per ring, phase
    uniform float uTime;
    varying float vAlpha;
    void main() {
      float age = fract(uTime / aRipple.y + aRipple.z);
      vec3 p = position * aRipple.x * (0.12 + 0.88 * sqrt(age));
      vAlpha = (1.0 - age) * smoothstep(0.0, 0.1, age);
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      gl_FragColor = vec4(uColor, vAlpha * 0.55);
    }
  `,
  uniforms: { uTime: lighting.time, uColor: { value: new THREE.Color("#eef6f4").convertLinearToSRGB() } },
  transparent: true,
  depthWrite: false,
});

/** Rings spreading and fading on the water; worked out in the shader, so nothing moves on this side. */
function Ripples({ ripples }: { ripples: Ripple[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = RINGS.clone();
    g.setAttribute("aRipple", new THREE.InstancedBufferAttribute(new Float32Array(ripples.flatMap((r) => [r.size, r.period, r.phase])), 3));
    return g;
  }, [ripples]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    ripples.forEach((r, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(r.x, 0.045, r.z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ripples]);
  return <instancedMesh ref={ref} args={[geometry, rippleMaterial, ripples.length]} raycast={() => null} dispose={null} />;
}
