import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "./Ambient";
import { Kit, type BuiltMesh } from "./kit";
import { shade } from "./models";
import { pencilMaterial, shadowMaterial } from "./pencil";
import { ROAD_TOP } from "./sceneryLayout";
import { carAt, lanes, type CarModel } from "./trafficLayout";

/**
 * Now and then a car going by on the street out front, one way or the other (see trafficLayout): little
 * pencil hatchbacks, vans and pickups in cheerful paint. Only for show: they can't be clicked, never leave
 * the street, and with reduced motion the street stays empty. They don't cast into the sun's shadow map, which
 * is only redrawn every other frame and would leave a shadow trailing behind a moving car; a drawn patch of
 * shade goes along underneath instead.
 */

type V3 = [number, number, number];

/** A tyre with its hub cap facing out, at `x` along the car and `z` across it. */
function wheel(k: Kit, x: number, z: number, r: number) {
  const tyre = pencilMaterial("#3a3631");
  const hub = pencilMaterial("#c9c5bc", { finish: "metal" });
  k.add("cyl", tyre, [x, r, z], [r * 2, 0.22, r * 2], { rot: [Math.PI / 2, 0, 0], outline: 0.008 });
  k.add("cyl", hub, [x, r, z + Math.sign(z) * 0.115], [r, 0.02, r], { rot: [Math.PI / 2, 0, 0], outline: false });
}

/** Lamps and bumpers at both ends of a body `len` long and `wide` across, its lamps this high. */
function ends(k: Kit, len: number, wide: number, lamp: number) {
  const bumper = pencilMaterial("#6f6c67", { finish: "metal" });
  const head = pencilMaterial("#fff3c4", { finish: "glass" });
  const tail = pencilMaterial("#d9534f", { finish: "glass" });
  for (const s of [-1, 1]) {
    k.box(bumper, [(s * len) / 2, 0.42, 0], [0.14, 0.16, wide - 0.04], { outline: 0.006 });
    for (const side of [-1, 1]) k.box(s > 0 ? head : tail, [s * (len / 2 + 0.01), lamp, side * (wide / 2 - 0.3)], [0.04, 0.13, 0.28], { outline: 0.004 });
  }
}

/** Length and width of each model, for the shade underneath. */
const FOOTPRINT: Record<CarModel, [number, number]> = { hatch: [3.8, 1.7], van: [4.6, 1.85], pickup: [4.8, 1.8] };
const PATCH = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Shade under a car, as strong with the sun's shadows on as off (unlike the furniture's, which step back). */
function under(model: CarModel) {
  const [len, wide] = FOOTPRINT[model];
  const m = shadowMaterial(len + 0.7, wide + 0.6, 0.7).clone();
  m.uniforms.uContact = { value: 1 };
  return m;
}

/** A car facing +x with its wheels on the ground at y = 0. */
function car(k: Kit, model: CarModel, tone: string) {
  const paint = pencilMaterial(tone, { finish: "paint" });
  const trim = pencilMaterial(shade(tone, 0.78), { finish: "paint" });
  const glass = pencilMaterial("#a9c9d8", { finish: "glass" });
  const dark = pencilMaterial("#4a4642");
  const window = (pos: V3, size: V3, rot: V3 = [0, 0, 0]) => k.box(glass, pos, size, { rot, outline: 0.004 });

  if (model === "hatch") {
    k.add("roundbox", paint, [0, 0.64, 0], [3.8, 0.6, 1.7], { outline: 0.012 });
    k.add("roundbox", paint, [-0.3, 1.16, 0], [2.1, 0.56, 1.56], { outline: 0.012 });
    window([0.8, 1.14, 0], [0.05, 0.5, 1.38], [0, 0, -0.55]);
    window([-1.36, 1.16, 0], [0.04, 0.4, 1.34]);
    for (const s of [-1, 1]) {
      window([-0.32, 1.18, s * 0.785], [1.8, 0.38, 0.02]);
      k.box(trim, [-0.32, 1.18, s * 0.79], [0.06, 0.4, 0.02], { outline: false });
      k.box(trim, [0, 0.66, s * 0.855], [3.6, 0.05, 0.01], { outline: false });
    }
    ends(k, 3.8, 1.7, 0.74);
    for (const x of [-1.2, 1.2]) for (const z of [-0.78, 0.78]) wheel(k, x, z, 0.32);
    return;
  }
  if (model === "van") {
    k.add("roundbox", paint, [0, 1.1, 0], [4.6, 1.5, 1.85], { outline: 0.014 });
    window([2.31, 1.48, 0], [0.04, 0.55, 1.6]);
    for (const s of [-1, 1]) {
      window([0.3, 1.52, s * 0.93], [3.5, 0.46, 0.02]);
      k.box(pencilMaterial("#f4efe4", { finish: "paint" }), [0, 0.95, s * 0.93], [4.5, 0.12, 0.02], { outline: false });
      k.box(trim, [0.25, 1.0, s * 0.935], [0.03, 0.95, 0.01], { outline: false });
    }
    k.box(dark, [-2.31, 1.48, 0], [0.04, 0.5, 1.3], { outline: 0.004 });
    ends(k, 4.6, 1.85, 0.75);
    for (const x of [-1.55, 1.55]) for (const z of [-0.84, 0.84]) wheel(k, x, z, 0.34);
    return;
  }
  // a pickup: a cab in front and an open bed behind, with a crate in it
  k.add("roundbox", paint, [0, 0.72, 0], [4.8, 0.7, 1.8], { outline: 0.012 });
  k.add("roundbox", paint, [0.6, 1.38, 0], [1.6, 0.66, 1.7], { outline: 0.012 });
  window([1.43, 1.36, 0], [0.05, 0.5, 1.5], [0, 0, -0.35]);
  window([-0.21, 1.4, 0], [0.04, 0.4, 1.4]);
  for (const s of [-1, 1]) {
    window([0.62, 1.42, s * 0.86], [1.3, 0.4, 0.02]);
    k.box(paint, [-1.3, 1.26, s * 0.85], [2.2, 0.4, 0.1], { outline: 0.008 });
  }
  k.box(dark, [-1.3, 1.08, 0], [2.2, 0.02, 1.6], { outline: false });
  k.box(paint, [-2.35, 1.26, 0], [0.1, 0.4, 1.8], { outline: 0.008 });
  k.box(pencilMaterial("#b98a5a", { finish: "wood" }), [-1.5, 1.33, 0.2], [0.6, 0.48, 0.6], { rot: [0, 0.3, 0], outline: 0.008 });
  ends(k, 4.8, 1.8, 0.82);
  for (const x of [-1.5, 1.5]) for (const z of [-0.8, 0.8]) wheel(k, x, z, 0.36);
}

export function Traffic({ w, d }: { w: number; d: number }) {
  const quiet = useReducedMotion();
  const all = useMemo(() => lanes(d), [d]);
  // each look built once, however many slots share it
  const shade = useMemo(() => new Map((["hatch", "van", "pickup"] as const).map((m) => [m, under(m)])), []);
  useEffect(() => () => shade.forEach((m) => m.dispose()), [shade]);
  const built = useMemo(() => {
    const looks = new Map<string, BuiltMesh[]>();
    for (const lane of all)
      for (const c of lane.cars) {
        const key = `${c.model}|${c.tone}`;
        if (looks.has(key)) continue;
        const k = new Kit();
        car(k, c.model, c.tone);
        looks.set(key, k.build());
      }
    return looks;
  }, [all]);
  useEffect(() => () => built.forEach((meshes) => meshes.forEach((b) => b.geometry.dispose())), [built]);
  const groups = useRef<(THREE.Group | null)[][]>([]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    all.forEach((lane, l) => {
      lane.cars.forEach((_, s) => {
        const g = groups.current[l]?.[s];
        if (!g) return;
        const x = carAt(lane, l, s, t);
        g.visible = x !== null;
        if (x === null) return;
        g.position.set(w / 2 + x, ROAD_TOP + Math.abs(Math.sin(t * 7 + s)) * 0.008, lane.z);
      });
    });
  });

  if (quiet) return null;
  return (
    <group name="traffic">
      {all.map((lane, l) =>
        lane.cars.map((c, s) => (
          <group
            key={`${l}:${s}`}
            ref={(g) => void ((groups.current[l] ??= [])[s] = g)}
            rotation-y={lane.dir > 0 ? 0 : Math.PI}
            visible={false}
          >
            {built.get(`${c.model}|${c.tone}`)!.map((b, i) => (
              <mesh key={i} geometry={b.geometry} material={b.material} raycast={() => null} userData={{ noShadow: true }} />
            ))}
            <mesh geometry={PATCH} material={shade.get(c.model)} scale={[FOOTPRINT[c.model][0] + 0.7, 1, FOOTPRINT[c.model][1] + 0.6]} position-y={0.006} raycast={() => null} />
          </group>
        )),
      )}
    </group>
  );
}
