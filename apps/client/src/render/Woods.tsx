import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { KitMesh } from "./KitMesh";
import { Kit, type BuiltMesh } from "./kit";
import { CROWN, BOUGH, treeLimb, natureMaterial } from "./nature";
import { woodsLayout, type Thing, type Tree, type UnderKind } from "./woodsLayout";

/**
 * The woods (see woodsLayout). The trees are merged into a few big meshes, as before; the things under them
 * (bushes, ferns, stumps, logs, branches, mushrooms) are each drawn once and repeated as instances, so a hundred
 * ferns cost what one does. Beyond it all, a ring of plain dark firs fades into the haze.
 */

type V3 = [number, number, number];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A pointed cone for fir tiers (the kit's own cone is cut off at the top). */
const FIR = new THREE.ConeGeometry(0.5, 1, 8);
/** A crude ball, for crowns far off and for tiny spots. */
const COARSE = new THREE.IcosahedronGeometry(0.5, 0);
/** A mushroom cap: a low dome. */
const CAP = new THREE.SphereGeometry(0.5, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
/** Trees further than this from the lot's middle get coarser crowns. */
const FAR = 68;

export function Woods({ w, d }: { w: number; d: number }) {
  const woods = woodsLayout(w, d);
  const sets = useMemo(
    () => (Object.keys(MODELS) as UnderKind[]).flatMap((kind) => MODELS[kind].map((make, v) => ({ key: `${kind}${v}`, make, things: woods.under[kind].filter((t) => t.v === v) }))),
    [woods],
  );
  return (
    <group name="woods">
      <KitMesh deps={[w, d]} make={(k) => trees(k, woods.trees, w, d)} />
      {sets.map(({ key, make, things }) => (
        <Instances key={key} make={make} things={things} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- trees

const TRUNK = () => natureMaterial("#7a5c43", { finish: "bark" });
const FIRS = ["#256b43", "#327f47", "#4b944c"];
const LEAFY = ["#4f9e3f", "#69b345", "#7bbb4a"];
const BIRCH_LEAVES = ["#8ac44b", "#a3cd59", "#75b542"];

export function trees(k: Kit, list: Tree[], w: number, d: number) {
  const cx = w / 2;
  const cz = d / 2;
  for (const t of list) {
    const r = rng(t.seed);
    const { x, z, s, h } = t;
    if (Math.hypot(x - cx, z - cz) < 38) for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + t.seed;
      treeLimb(k, TRUNK(), [x, 0.22 * s, z], [x + Math.cos(a) * 0.45 * s, 0.02, z + Math.sin(a) * 0.45 * s], 0.09 * s);
    }
    // deep in, where nobody gets close, crowns are cut from a coarser ball (a quarter of the faces)
    const near = Math.hypot(x - cx, z - cz) <= FAR;
    const blob = near ? CROWN : COARSE;
    const fir = near ? BOUGH : FIR;
    if (t.kind === "fir" || t.kind === "spire") {
      const slim = t.kind === "spire";
      const tiers = near ? (slim ? 6 : 5) : (slim ? 5 : 3);
      const leaf = natureMaterial(FIRS[t.tone]!, { finish: "canopy", sway: 0.0015 });
      k.add("cyl8", TRUNK(), [x, 0.6 * s, z], [0.25 * s, 1.2 * s, 0.25 * s], { outline: 0.02 });
      for (let i = 0; i < tiers; i++) {
        const f = i / (tiers - 1);
        const width = (slim ? 1.75 - f * 1.4 : 2.5 - f * 2.0) * s;
        k.add(fir, leaf, [x, (1.3 + f * (slim ? 3.6 : 2.5)) * s * h, z], [width, (slim ? 1.4 : 1.6) * s * h, width], { rot: [0, r() * 3, 0], outline: 0.03 });
      }
      // Visible tips of irregular lower boughs break the perfectly conical silhouette up close.
      if (Math.hypot(x - cx, z - cz) < 38) for (let i = 0; i < 8; i++) {
        const a = i * 2.4 + t.seed, radius = (0.62 + (i % 3) * 0.15) * s;
        k.add(CROWN, leaf, [x + Math.cos(a) * radius, (1.1 + (i % 4) * 0.48) * s * h, z + Math.sin(a) * radius], [0.8 * s, 0.36 * s, 0.65 * s], { rot: [0, -a, 0], outline: false });
      }
    } else if (t.kind === "leafy" || t.kind === "tall") {
      const tall = t.kind === "tall";
      const leaf = natureMaterial(r() < 0.06 ? "#a39153" : LEAFY[t.tone]!, { finish: "canopy", sway: 0.0015 });
      const trunkH = (tall ? 2.6 : 2.2) * s * h;
      k.add("cyl8", TRUNK(), [x, trunkH / 2, z], [0.22 * s, trunkH, 0.22 * s], { outline: 0.02 });
      const n = tall ? 5 : 4 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const b = r() * Math.PI * 2;
        const rr = r() * (tall ? 0.45 : 0.8) * s;
        // a tall tree's crown is an upright oval of blobs that overlap well, narrowing toward the top
        const y = tall ? trunkH + (i * 0.42 - 0.2) * s * h : (2.5 + r() * 1.1) * s * h;
        const girth = tall ? (1.45 - i * 0.12) * s : 0;
        if (near) treeLimb(k, TRUNK(), [x, trunkH * 0.72, z], [x + Math.cos(b) * rr, y, z + Math.sin(b) * rr], 0.065 * s);
        k.add(blob, leaf, [x + Math.cos(b) * rr, y, z + Math.sin(b) * rr], tall ? [girth, 1.35 * s * h, girth] : (1.3 + r() * 0.7) * s, { outline: 0.03 });
      }
    } else if (t.kind === "birch") {
      // a slim pale trunk with dark marks, and a light, airy crown
      const trunkH = 3.2 * s * h;
      k.add("cyl8", natureMaterial("#ece6da"), [x, trunkH / 2, z], [0.17 * s, trunkH, 0.17 * s], { outline: 0.018 });
      for (let i = 0; i < 4; i++) k.box(natureMaterial("#3a3631"), [x, (0.5 + i * 0.6 + r() * 0.2) * s * h, z], [0.18 * s, 0.035, 0.08 * s], { rot: [0, r() * 3, 0], outline: false });
      const leaf = natureMaterial(BIRCH_LEAVES[t.tone]!, { finish: "canopy", sway: 0.0015 });
      for (let i = 0; i < 6; i++) {
        const b = r() * Math.PI * 2;
        const rr = (0.3 + r() * 0.6) * s;
        k.add(blob, leaf, [x + Math.cos(b) * rr, trunkH - 0.4 * s + r() * 1.4 * s * h, z + Math.sin(b) * rr], (0.75 + r() * 0.45) * s, { outline: 0.025 });
      }
    } else {
      // a young tree: a thin stem with a little crown, or a small fir
      if (t.seed % 2) {
        k.add("cyl8", TRUNK(), [x, 0.45 * s, z], [0.1 * s, 0.9 * s, 0.1 * s], { outline: 0.01 });
        k.add(CROWN, natureMaterial(LEAFY[t.tone]!), [x, 1.05 * s * h, z], [0.8 * s, 0.9 * s * h, 0.8 * s], { outline: 0.016 });
        k.add(CROWN, natureMaterial(LEAFY[(t.tone + 1) % 3]!), [x + 0.2 * s, 1.35 * s * h, z - 0.1 * s], 0.55 * s, { outline: 0.014 });
      } else {
        k.add("cyl8", TRUNK(), [x, 0.2 * s, z], [0.1 * s, 0.4 * s, 0.1 * s], { outline: 0.01 });
        for (let i = 0; i < 2; i++) k.add(fir, natureMaterial(FIRS[t.tone]!, { finish: "canopy", sway: 0.0015 }), [x, (0.6 + i * 0.5) * s * h, z], [(1.1 - i * 0.4) * s, 0.9 * s * h, (1.1 - i * 0.4) * s], { outline: 0.016 });
      }
    }
  }
  // the far edge of the forest: plain dark firs, packed close, fading into the haze
  const r = rng(13);
  const farFir = [natureMaterial("#3a7050", { rim: false, fog: 0.8 }), natureMaterial("#2f6247", { rim: false, fog: 0.8 })];
  for (let n = 0; n < 700; n++) {
    const a = r() * Math.PI * 2;
    const dist = 94 + r() * 50;
    const s = 1.4 + r() * 1.2;
    const [x, z] = [cx + Math.cos(a) * dist, cz + Math.sin(a) * dist];
    // the street runs on out through them into the haze
    if (z > d + 0.5 - 1.2 * s && z < d + 12 + 1.2 * s) continue;
    k.add(FIR, farFir[n % 2]!, [x, 3 * s, z], [2.4 * s, 6 * s, 2.4 * s], { outline: false });
  }
}

// ---------------------------------------------------------------- understory

/** Each kind's variants, built once at the origin, standing on y = 0. */
export const MODELS: Record<UnderKind, ((k: Kit) => void)[]> = {
  bush: [
    (k) => {
      const greens = ["#5f8f48", "#6c9e57"].map((c) => natureMaterial(c, { finish: "canopy", sway: 0.0015 }));
      k.add(CROWN, greens[0]!, [0, 0.38, 0], [1.1, 0.8, 1.0], { outline: 0.014 });
      k.add(CROWN, greens[1]!, [0.45, 0.3, 0.2], [0.8, 0.6, 0.75], { outline: 0.012 });
      k.add(CROWN, greens[1]!, [-0.4, 0.28, -0.15], [0.7, 0.55, 0.7], { outline: 0.012 });
    },
    (k) => {
      // flowering: a few pink and cream blossoms dotted over it
      k.add(CROWN, natureMaterial("#668f4c", { finish: "canopy", sway: 0.0015 }), [0, 0.42, 0], [1.2, 0.85, 1.05], { outline: 0.014 });
      k.add(CROWN, natureMaterial("#73a058", { finish: "canopy", sway: 0.0015 }), [-0.35, 0.3, 0.3], [0.7, 0.55, 0.65], { outline: 0.012 });
      const r = rng(5);
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2;
        const up = 0.25 + r() * 0.6;
        k.add(COARSE, natureMaterial(i % 3 ? "#e8a0b4" : "#f5eed9", { rim: false }), [Math.cos(a) * 0.5 * Math.cos(up), 0.42 + Math.sin(up) * 0.42, Math.sin(a) * 0.45 * Math.cos(up)], 0.09, { outline: false });
      }
    },
    (k) => {
      k.add(CROWN, natureMaterial("#4f7f42", { finish: "canopy", sway: 0.0015 }), [0, 0.5, 0], [1.2, 1.0, 1.2], { outline: 0.014 });
      k.add(CROWN, natureMaterial("#5f8f48", { finish: "canopy", sway: 0.0015 }), [0.55, 0.25, -0.2], [0.55, 0.45, 0.55], { outline: 0.01 });
    },
  ],
  fern: [0, 1].map((v) => (k: Kit) => {
    const greens = (v ? ["#6f9e50", "#7fae5a"] : ["#5e8f45", "#6a9a4c"]).map((c) => natureMaterial(c, { rim: false, sway: 0.2 }));
    const n = v ? 6 : 8;
    for (let i = 0; i < n; i++) k.add(FROND, greens[i % 2]!, [0, 0.02, 0], [0.85 + (i % 3) * 0.15, 0.85 + ((i + v) % 2) * 0.2, 1.6], { rot: [0, (i / n) * Math.PI * 2 + v * 0.3, 0], outline: false });
  }),
  stump: [0, 1].map((v) => (k: Kit) => {
    const bark = natureMaterial("#7a5c43", { finish: "bark" });
    k.add("cyl8", bark, [0, 0.2, 0], [0.55, 0.4, 0.55], { outline: 0.01 });
    k.add("cyl8", natureMaterial("#d9b07a"), [0, 0.403, 0], [0.48, 0.01, 0.48], { outline: false });
    k.add("cyl8", natureMaterial("#b98a5a"), [0, 0.406, 0], [0.24, 0.01, 0.24], { outline: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      k.add("cyl8", bark, [Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3], [0.13, 0.32, 0.13], { rot: [0, -a, Math.PI / 2 - 0.35], outline: 0.006 });
    }
    if (v) k.add(CROWN, natureMaterial("#7f9a5a", { rim: false }), [0.12, 0.38, 0.05], [0.32, 0.1, 0.26], { outline: false });
  }),
  log: [0, 1].map((v) => (k: Kit) => {
    const len = v ? 1.5 : 2.2;
    const bark = natureMaterial("#6e5240", { finish: "bark" });
    k.add("cyl8", bark, [0, 0.2, 0], [0.42, len, 0.42], { rot: [0, 0, Math.PI / 2], outline: 0.012 });
    for (const s of [-1, 1]) k.add("cyl8", natureMaterial("#d9b07a"), [(s * len) / 2, 0.2, 0], [0.37, 0.012, 0.37], { rot: [0, 0, Math.PI / 2], outline: false });
    if (v) k.add("cyl8", natureMaterial("#4a3a2e"), [len / 2 + 0.008, 0.2, 0], [0.2, 0.012, 0.2], { rot: [0, 0, Math.PI / 2], outline: false });
    k.add("cyl8", bark, [len * 0.15, 0.4, 0.05], [0.07, 0.35, 0.07], { rot: [0.3, 0, -0.5], outline: 0.004 });
    k.add(CROWN, natureMaterial("#7f9a5a", { rim: false }), [-len * 0.18, 0.39, 0], [len * 0.35, 0.09, 0.3], { outline: false });
  }),
  branch: [0, 1].map((v) => (k: Kit) => {
    const wood = natureMaterial("#6e5240", { finish: "bark" });
    k.add("cyl8", wood, [0, 0.035, 0], [0.07, 1.3, 0.07], { rot: [0, 0, Math.PI / 2], outline: 0.004 });
    const twig = (at: number, a: number, len: number) => k.add("cyl8", wood, [at + Math.cos(a) * len * 0.5, 0.03, Math.sin(a) * len * 0.5], [0.04, len, 0.04], { rot: [0, -a, Math.PI / 2], outline: 0.003 });
    twig(0.25, 0.6, 0.45);
    twig(-0.3, -0.7, 0.35);
    if (v) twig(0.5, -0.5, 0.5);
  }),
  mushrooms: [0, 1].map((v) => (k: Kit) => {
    const stem = natureMaterial("#efe6d2");
    const cap = natureMaterial(v ? "#a26a3f" : "#c9493c");
    const spots = [[0, 0, 1], [0.12, 0.08, 0.7], [-0.1, 0.1, 0.55], [0.05, -0.12, 0.5]] as const;
    for (const [x, z, sz] of spots.slice(0, v ? 4 : 3)) {
      const h = 0.13 * sz;
      k.add("cyl8", stem, [x, h / 2, z], [0.045 * sz, h, 0.045 * sz], { outline: 0.003 });
      k.add(CAP, cap, [x, h, z], [0.17 * sz, 0.1 * sz, 0.17 * sz], { outline: 0.004 });
      if (!v) for (let i = 0; i < 3; i++) k.add(COARSE, natureMaterial("#f7f1e3", { rim: false }), [x + Math.cos(i * 2.1) * 0.045 * sz, h + 0.045 * sz, z + Math.sin(i * 2.1) * 0.045 * sz], 0.025 * sz, { outline: false });
    }
  }),
};

/**
 * A fern frond: a strip arching up and out along +x, tapering to its tip, its edge notched into leaflets.
 */
const FROND = (() => {
  const SEG = 6;
  const pos: number[] = [];
  const at = (i: number, side: number): V3 => {
    const t = i / SEG;
    const width = 0.13 * (1 - t) * Math.min(1, t / 0.15) * (i % 2 ? 1 : 0.5);
    return [t, 0.6 * t - 0.55 * t * t, side * width];
  };
  for (let i = 0; i < SEG; i++) {
    const a = at(i, 0);
    const b = at(i + 1, 0);
    for (const side of [-1, 1]) {
      const c = at(i, side);
      const e = at(i + 1, side);
      // wound to face up: fronds are seen from above, and the arch hides their undersides
      for (const tri of side > 0 ? [[a, e, b], [a, c, e]] : [[a, b, e], [a, e, c]]) pos.push(...tri[0]!, ...tri[1]!, ...tri[2]!);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
})();

/** One understory model repeated at every place in `things`: an instanced mesh for each of its parts. */
function Instances({ make, things }: { make: (k: Kit) => void; things: Thing[] }) {
  const model = useMemo(() => {
    const k = new Kit();
    make(k);
    return k.build();
  }, [make]);
  useEffect(() => () => model.forEach((b) => b.geometry.dispose()), [model]);
  if (!things.length) return null;
  return (
    <>
      {model.map((mesh, i) => (
        <InstanceSet key={`${i}:${things.length}`} mesh={mesh} things={things} />
      ))}
    </>
  );
}

function InstanceSet({ mesh, things }: { mesh: BuiltMesh; things: Thing[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const target = ref.current!;
    const o = new THREE.Object3D();
    things.forEach((t, i) => {
      o.position.set(t.x, 0, t.z);
      o.rotation.set(0, t.ry, 0);
      o.scale.setScalar(t.s);
      o.updateMatrix();
      target.setMatrixAt(i, o.matrix);
    });
    target.instanceMatrix.needsUpdate = true;
    target.computeBoundingSphere();
  }, [things]);
  return <instancedMesh ref={ref} args={[mesh.geometry, mesh.material, things.length]} dispose={null} raycast={() => null} />;
}
