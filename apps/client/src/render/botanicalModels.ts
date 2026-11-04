import * as THREE from "three";
import type { Kit } from "./kit";
import type { Finish } from "./pencil";

type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Builder = (k: Kit, w: number, d: number, p: Record<string, unknown>, m: Mat, seed: number) => void;
export type FlowerKind = "daisy" | "tulip" | "lavender";
/** How far outdoor grass and flowers sway in the breeze (see `pencilMaterial`). */
export const SWAY = 0.25;
const LEAF = new THREE.SphereGeometry(0.5, 6, 4);
const STEM = new THREE.CylinderGeometry(0.5, 0.5, 1, 5);
const PETAL = new THREE.SphereGeometry(0.5, 7, 4);
const BUD = new THREE.IcosahedronGeometry(0.5, 0);

/** A folded, tapered blade. The back face is explicit so it reads from every camera angle. */
function blade() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.045, 0, 0, 0, 0.18, 0.025, 0.045, 0, 0,
    0.045, 0, 0, 0, 0.18, 0.025, 0.055, 0.38, 0.11,
    0.055, 0.38, 0.11, 0, 0.18, 0.025, -0.045, 0, 0,
    0.045, 0, 0, 0, 0.18, 0.025, -0.045, 0, 0,
    0.055, 0.38, 0.11, 0, 0.18, 0.025, 0.045, 0, 0,
    -0.045, 0, 0, 0, 0.18, 0.025, 0.055, 0.38, 0.11,
  ], 3));
  g.computeVertexNormals();
  return g;
}
const BLADE = blade();

export function grassTuft(k: Kit, m: Mat) {
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4;
    const s = 0.62 + (i % 3) * 0.19;
    k.add(BLADE, m(i % 2 ? "#6e934f" : "#8aa95d"), [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], [s, s, s], { rot: [0, a, 0], outline: false });
  }
}

/** One low-poly flower with a proper stem, paired leaves and shaped petals. Ground is y=0. */
export function flower(k: Kit, m: Mat, kind: FlowerKind, tone: string, height = 0.46) {
  const green = m("#597c48"), leaf = m("#7c9c61");
  k.add(STEM, green, [0, height / 2, 0], [0.018, height, 0.018], { outline: false });
  for (const s of [-1, 1]) {
    k.add(LEAF, leaf, [s * 0.055, height * (s > 0 ? 0.35 : 0.54), 0], [0.16, 0.035, 0.068], { rot: [0, s * 0.4, s * 0.42], outline: false });
  }
  if (kind === "lavender") {
    for (let tier = 0; tier < 4; tier++) for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + tier * 0.8;
      const radius = 0.033 * (1 - tier * 0.12);
      k.add(BUD, m(tier % 2 ? "#b2a1c9" : tone), [Math.cos(a) * radius, height - 0.1 + tier * 0.043, Math.sin(a) * radius], [0.055 - tier * 0.006, 0.065, 0.055 - tier * 0.006], { outline: false });
    }
  } else if (kind === "tulip") {
    k.add(BUD, m(tone), [0, height - 0.005, 0], [0.12, 0.13, 0.12], { outline: false });
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      k.add(PETAL, m(tone), [Math.cos(a) * 0.048, height + 0.02, Math.sin(a) * 0.048], [0.085, 0.14, 0.045], { rot: [Math.cos(a) * -0.22, -a, Math.sin(a) * 0.22], outline: false });
    }
    k.add(BUD, m("#f2cc72"), [0, height + 0.04, 0], 0.028, { outline: false });
  } else {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      k.add(PETAL, m(tone), [Math.cos(a) * 0.075, height, Math.sin(a) * 0.075], [0.115, 0.032, 0.055], { rot: [0, -a, 0], outline: false });
    }
    k.add(BUD, m("#dcae42"), [0, height + 0.015, 0], [0.075, 0.045, 0.075], { outline: false });
  }
}

export const BOTANICAL_BUILDERS: Record<string, Builder> = {
  flowers(k, w, d, p, m) {
    const kind: FlowerKind = p.flower === "tulip" || p.flower === "lavender" ? p.flower : "daisy";
    const pot = m(typeof p.pot === "string" ? p.pot : "#c98764");
    const petals = typeof p.petals === "string" ? p.petals : "#f5efdb";
    const soil = m("#655343");
    const box = w > 1;
    if (box) {
      k.box(pot, [0, 0.14, 0], [w - 0.2, 0.28, d - 0.3], { outline: 0.007 });
      k.box(soil, [0, 0.283, 0], [w - 0.28, 0.008, d - 0.38], { outline: false });
      for (const z of [-1, 1]) k.box(pot, [0, 0.29, z * (d - 0.32) / 2], [w - 0.16, 0.06, 0.07], { outline: 0.004 });
      for (const x of [-1, 1]) k.box(pot, [x * (w - 0.22) / 2, 0.29, 0], [0.07, 0.06, d - 0.28], { outline: 0.004 });
    } else {
      k.add("cone", pot, [0, 0.12, 0], [0.48, 0.24, 0.48], { rot: [Math.PI, 0, 0], outline: 0.006 });
      k.add("cyl", pot, [0, 0.23, 0], [0.5, 0.07, 0.5], { outline: 0.004 });
      k.add("cyl", soil, [0, 0.268, 0], [0.43, 0.008, 0.43], { outline: false });
      k.add("torus", m("#e8c7a2"), [0, 0.2, 0], 0.46, { rot: [Math.PI / 2, 0, 0], outline: false });
    }
    const count = box ? 9 : 7;
    for (let i = 0; i < count; i++) {
      const a = i * 2.4;
      const radius = i === 0 ? 0 : 0.12 + (i % 2) * 0.045;
      const x = box ? -0.68 + (i % 5) * 0.34 : Math.cos(a) * radius;
      const z = box ? (i < 5 ? -0.12 : 0.15) : Math.sin(a) * radius;
      k.at([x, box ? 0.287 : 0.272, z], a, () => flower(k, m, kind, petals, 0.27 + (i % 3) * 0.065));
    }
  },
};
