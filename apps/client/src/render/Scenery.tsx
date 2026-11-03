import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { KitMesh } from "./KitMesh";
import type { Kit } from "./kit";
import { FOG, pencilMaterial, SUN_DIR } from "./pencil";
import { lakeShape } from "./sceneryLayout";
import { Meadow } from "./Meadow";
import { Yard } from "./Yard";

/**
 * The countryside around the lot: a lake behind the house with a little jetty, woods of firs and leafy trees
 * all round (keeping clear of the lot, the street and the water), snow-capped mountains on the horizon and a
 * sky with soft clouds. All decoration: nothing here can be clicked or built on.
 */

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A flat disc on a polar grid; uv.x runs from 0 at the rim to 1 in the middle, so the water knows its depth. */
function disc(lake: ReturnType<typeof lakeShape>, grow: number, y: number) {
  const SEG = 96;
  const RINGS = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const f = (lake.reach(a) * (1 - i / RINGS)) * 1 + (i === 0 ? grow : grow * (1 - i / RINGS));
      pos.push(lake.cx + Math.cos(a) * lake.rx * f, y, lake.cz + Math.sin(a) * lake.rz * f);
      uv.push(i / RINGS, j / SEG);
    }
  }
  for (let i = 0; i < RINGS; i++)
    for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      const c = (i + 1) * SEG + j;
      const d = (i + 1) * SEG + ((j + 1) % SEG);
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A pointed cone for fir tiers (the kit's own cone is cut off at the top). */
const FIR = new THREE.ConeGeometry(0.5, 1, 8);

/** A rugged mountain: a cone with its sides pushed in and out, drawn faceted. */
function mountain(seed: number) {
  const r = rng(seed);
  const g = new THREE.ConeGeometry(0.5, 1, 11, 5);
  const p = g.attributes.position!;
  const bumps = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const t = y + 0.5;
    // same position, same push, so the seams stay closed
    const push = 1 + 0.22 * Math.sin(3 * a + bumps[0]!) * Math.sin(t * 4 + bumps[1]!) + 0.12 * Math.sin(7 * a + bumps[2]!) * t;
    p.setXYZ(i, x * push, y + (t > 0.05 && t < 0.99 ? 0.05 * Math.sin(5 * a + bumps[1]!) : 0), z * push);
  }
  g.translate(0, 0.5, 0);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

export function Scenery({ w, d }: { w: number; d: number }) {
  const lake = useMemo(() => lakeShape(w), [w]);
  return (
    <group name="scenery">
      <Sky />
      <Lake lake={lake} />
      <Yard w={w} d={d} />
      <Meadow w={w} d={d} />
      <KitMesh key="woods" deps={[w, d, lake]} make={(k) => woods(k, w, d, lake)} />
      <KitMesh key="mountains" deps={[w, d]} make={(k) => mountains(k, w, d)} />
    </group>
  );
}

function Lake({ lake }: { lake: ReturnType<typeof lakeShape> }) {
  const shore = useMemo(() => disc(lake, 0.06, 0.012), [lake]);
  const water = useMemo(() => disc(lake, 0, 0.03), [lake]);
  useEffect(
    () => () => {
      shore.dispose();
      water.dispose();
    },
    [shore, water],
  );
  return (
    <group>
      <mesh geometry={shore} material={pencilMaterial("#cdbb8e", { rim: false })} raycast={() => null} />
      <mesh geometry={water} material={pencilMaterial("#3a8fb0", { finish: "lake", rim: false })} raycast={() => null} />
      <KitMesh
        deps={[lake]}
        make={(k) => {
          // a little wooden jetty out from the near shore
          const x = lake.cx + 3;
          const shoreZ = lake.cz + lake.rz * lake.reach(Math.PI / 2);
          const boards = pencilMaterial("#b98a5a", { finish: "wood" });
          const post = pencilMaterial("#7a5c43", { finish: "wood" });
          k.box(boards, [x, 0.42, shoreZ - 3.2], [1.5, 0.08, 7.5], { outline: 0.012 });
          for (let z = 0; z <= 7; z += 1.75) for (const sx of [-0.68, 0.68]) k.add("cyl8", post, [x + sx, 0.3, shoreZ + 0.4 - z], [0.12, 0.7, 0.12], { outline: 0.008 });
          // rocks and reeds along the shore
          const r = rng(31);
          const rock = [pencilMaterial("#9c9a92"), pencilMaterial("#b2ada2")];
          const reed = pencilMaterial("#6f8f4a");
          for (let i = 0; i < 40; i++) {
            const a = r() * Math.PI * 2;
            const f = lake.reach(a) * (0.98 + r() * 0.08);
            const px = lake.cx + Math.cos(a) * lake.rx * f;
            const pz = lake.cz + Math.sin(a) * lake.rz * f;
            if (Math.abs(px - x) < 2.5 && pz > lake.cz) continue;
            if (r() < 0.45) k.add("blob", rock[i % 2]!, [px, 0.1, pz], [0.5 + r() * 0.8, 0.35 + r() * 0.3, 0.5 + r() * 0.7], { outline: 0.012 });
            else for (let j = 0; j < 5; j++) k.add("cyl8", reed, [px + (r() - 0.5) * 0.6, 0.4, pz + (r() - 0.5) * 0.6], [0.04, 0.8 + r() * 0.5, 0.04], { outline: false });
          }
        }}
      />
    </group>
  );
}

function woods(k: Kit, w: number, d: number, lake: ReturnType<typeof lakeShape>) {
  const r = rng(11);
  const cx = w / 2;
  const cz = d / 2;
  const firs = ["#2f6a45", "#3b7a4c", "#477f50"].map((c) => pencilMaterial(c));
  const leafy = ["#5f9e4f", "#6fa957", "#7aa95a"].map((c) => pencilMaterial(c));
  const autumn = pencilMaterial("#d98c3f");
  const trunk = pencilMaterial("#7a5c43", { finish: "wood" });
  const farFir = [pencilMaterial("#3a7050", { rim: false, fog: 0.8 }), pencilMaterial("#2f6247", { rim: false, fog: 0.8 })];
  const clear = (x: number, z: number, margin: number) => {
    if (x > -16 - margin && x < w + 9 + margin && z > -8 - margin && z < d + 13 + margin) return false; // the lot, the campsite and the playground
    if (z > d + 1.5 && z < d + 13 && x > -32 && x < w + 32) return false; // the street
    return !lake.inside(x, z, 3 + margin);
  };
  // near woods: firs and leafy trees with outlines, in loose clumps
  for (let n = 0; n < 900 && k.parts.length < 2600; n++) {
    const a = r() * Math.PI * 2;
    const dist = 24 + Math.pow(r(), 0.8) * 70;
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    // thinner nearer the house, so the lot keeps a meadow round it
    if (r() > 0.25 + (dist - 24) / 55 || !clear(x, z, 0)) continue;
    const s = 0.8 + r() * 0.7;
    if (r() < 0.65) {
      const mat = firs[Math.floor(r() * firs.length)]!;
      k.add("cyl8", trunk, [x, 0.6 * s, z], [0.25 * s, 1.2 * s, 0.25 * s], { outline: 0.02 });
      for (let t = 0; t < 3; t++) k.add(FIR, mat, [x, (1.3 + t * 1.25) * s, z], [(2.6 - t * 0.6) * s, 2.2 * s, (2.6 - t * 0.6) * s], { outline: 0.03 });
    } else {
      const mat = r() < 0.08 ? autumn : leafy[Math.floor(r() * leafy.length)]!;
      k.add("cyl8", trunk, [x, 1.1 * s, z], [0.22 * s, 2.2 * s, 0.22 * s], { outline: 0.02 });
      for (let i = 0; i < 4; i++) {
        const b = r() * Math.PI * 2;
        const rr = r() * 0.8 * s;
        k.add("blob", mat, [x + Math.cos(b) * rr, (2.5 + r() * 1.1) * s, z + Math.sin(b) * rr], (1.3 + r() * 0.7) * s, { outline: 0.03 });
      }
    }
  }
  // the far edge of the forest: plain dark firs, packed close, fading into the haze
  for (let n = 0; n < 700; n++) {
    const a = r() * Math.PI * 2;
    const dist = 94 + r() * 50;
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    if (!clear(x, z, 0)) continue;
    const s = 1.4 + r() * 1.2;
    k.add(FIR, farFir[n % 2]!, [x, 3 * s, z], [2.4 * s, 6 * s, 2.4 * s], { outline: false });
  }
}

function mountains(k: Kit, w: number, d: number) {
  const r = rng(5);
  const cx = w / 2;
  const cz = d / 2;
  const rock = [pencilMaterial("#6a819c", { finish: "mountain", rim: false, fog: 0.35 }), pencilMaterial("#7889a0", { finish: "mountain", rim: false, fog: 0.35 })];
  const COUNT = 18;
  for (let i = 0; i < COUNT; i++) {
    // a full ring of ranges, the tallest behind the lake; each a main peak with a shoulder or two
    const a = (i / COUNT) * Math.PI * 2 + (r() - 0.5) * 0.25;
    const behind = Math.max(0, -Math.sin(a));
    const dist = 215 + r() * 40;
    const h = 30 + r() * 18 + behind * 26;
    const peaks = 1 + Math.floor(r() * 3);
    for (let p = 0; p < peaks; p++) {
      const ph = h * (p === 0 ? 1 : 0.55 + r() * 0.3);
      const pa = a + (p === 0 ? 0 : (r() - 0.5) * 0.22);
      const pd = dist + (p === 0 ? 0 : (r() - 0.5) * 30);
      const base = ph * (1.7 + r() * 0.6);
      k.add(mountain(i * 7 + p * 101 + 3), rock[(i + p) % 2]!, [cx + Math.cos(pa) * pd, -1, cz + Math.sin(pa) * pd], [base, ph, base], { outline: 0.6 });
    }
  }
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * a;
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.55, h), 0.75));
    // a warm glow low in the sky toward the sun
    vec2 toSun = normalize(uSunDir.xz);
    float s = max(dot(normalize(d.xz + 1e-4), toSun), 0.0);
    col = mix(col, vec3(1.0, 0.87, 0.7), pow(s, 5.0) * (1.0 - smoothstep(0.0, 0.4, h)) * 0.5);
    // soft clouds, lit warm on top and lavender-grey beneath, with a faint pencilled edge
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
      float n = fbm(uv);
      float c = smoothstep(0.52, 0.7, n) * smoothstep(0.02, 0.14, h);
      vec3 cloud = mix(vec3(0.8, 0.79, 0.86), vec3(1.0, 0.97, 0.92), smoothstep(0.55, 0.85, fbm(uv + vec2(0.06, 0.09))));
      cloud = mix(cloud, vec3(1.0, 0.85, 0.72), pow(s, 4.0) * 0.35);
      col = mix(col, cloud, c * 0.92);
      float edge = 1.0 - smoothstep(0.0, 0.012, abs(n - 0.535));
      col = mix(col, vec3(0.35, 0.34, 0.38), edge * smoothstep(0.02, 0.14, h) * 0.18);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** A sky dome that travels with the camera, fading into the same haze as the distant ground at the horizon. */
function Sky() {
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: {
          uHorizon: { value: new THREE.Color(FOG).convertLinearToSRGB() },
          uZenith: { value: new THREE.Color("#7fb1df").convertLinearToSRGB() },
          uSunDir: { value: SUN_DIR },
          uTime: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        // drawn behind everything; Sunlight leaves it out of its shadow pictures
        transparent: true,
      }),
    [],
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(300, 32, 16), []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  useFrame(({ camera, clock }) => {
    ref.current?.position.copy(camera.position);
    material.uniforms.uTime!.value = clock.elapsedTime;
  });
  return <mesh ref={ref} geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} raycast={() => null} />;
}
