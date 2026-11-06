import * as THREE from "three";
import type { Kit } from "../kit";
import type { Finish } from "../pencil";
import { BALL_Y, HEAD_AT, HEAD_Y } from "./partyLayout";
import { glowMaterial, mirrorBallMaterial, platterMaterial, tileMaterial } from "./partyMaterials";

/**
 * The party items' models, drawn like the rest of the furniture (centred on the origin, standing on y = 0, facing
 * +z, inside the footprint). The glowing parts use the shared party materials, so they follow the lights panel; a
 * placement preview (`ghost`) swaps those for the usual pencil tint. Fixtures whose moving parts are drawn live
 * (moving heads, the disco ball) leave them out while the lights are on (`inUse`).
 */

type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Params = Record<string, unknown>;
type Builder = (k: Kit, w: number, d: number, p: Params, m: Mat, seed: number) => void;

const str = (p: Params, key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);

const METAL = "#b9b6ae";
const DARK = "#1c1c24";

/** The party's glowing material, or its ghost tint in a placement preview. */
const lit = (p: Params, m: Mat, material: THREE.Material = glowMaterial) => (p.ghost ? m("#8f8fc0", "glass") : material);

/** A rod between two points. */
function strut(k: Kit, mat: THREE.Material, a: [number, number, number], b: [number, number, number], width: number) {
  const from = new THREE.Vector3(...a);
  const delta = new THREE.Vector3(...b).sub(from);
  const geometry = new THREE.CylinderGeometry(width / 2, width / 2, delta.length(), 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
  k.add(geometry, mat, from.add(delta.clone().multiplyScalar(0.5)).toArray() as [number, number, number], 1, { outline: 0.003, normals: true });
}

/** A moving head's yoke: two arms to hang the head between, at the origin. */
export function headYoke(k: Kit, m: Mat, body: string) {
  const metal = m(body, "metal");
  for (const s of [-1, 1]) k.box(metal, [s * 0.085, 0.02, 0], [0.025, 0.2, 0.05], { outline: 0.004 });
}

/** A moving head's body and lens, pointing along +z and tipped down by `tilt` radians. */
export function headBody(k: Kit, m: Mat, glow: THREE.Material, body: string, tilt = 0.7) {
  k.at([0, 0, 0], [tilt, 0, 0], () => {
    k.add("cyl", m(DARK, "metal"), [0, 0, 0.04], [0.15, 0.2, 0.15], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("cyl", m(body, "metal"), [0, 0, -0.07], [0.12, 0.08, 0.12], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("cyl", glow, [0, 0, 0.142], [0.11, 0.01, 0.11], { rot: [Math.PI / 2, 0, 0], outline: false });
  });
}

export const PARTY_BUILDERS: Record<string, Builder> = {
  // A panel of dance floor, however many cells: a low frame, and in each cell a glass top the shared shader paints.
  dancetile: (k, w, d, p, m) => {
    const frame = m(str(p, "frame", "#2b2b33"), "metal");
    k.box(frame, [0, 0.014, 0], [w - 0.02, 0.028, d - 0.02], { outline: 0.004 });
    const top = lit(p, m, tileMaterial);
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) k.box(top, [-w / 2 + i + 0.5, 0.03, -d / 2 + j + 0.5], [0.97, 0.004, 0.97], { outline: false });
  },

  // A DJ booth: lit front, two decks with turning records, a mixer between them, a laptop and headphones.
  djbooth: (k, w, d, p, m) => {
    const body = str(p, "body", "#262630");
    const trim = str(p, "trim", "#00e5ff");
    const W = w - 0.1;
    const D = d - 0.18;
    const H = 0.9;
    const glow = lit(p, m);
    const cab = m(body, "paint");
    k.box(cab, [0, H / 2, 0], [W, H, D], { outline: 0.008 });
    // the lit front: a long panel of light bars behind a dark grille frame
    k.box(m(DARK, "metal"), [0, 0.47, D / 2 + 0.004], [W - 0.28, 0.66, 0.008], { outline: 0.004 });
    k.box(glow, [0, 0.47, D / 2 + 0.01], [W - 0.4, 0.58, 0.006], { outline: false });
    for (let i = 1; i < 12; i++) k.box(m(DARK, "metal"), [-(W - 0.4) / 2 + ((W - 0.4) * i) / 12, 0.47, D / 2 + 0.014], [0.012, 0.58, 0.004], { outline: false });
    k.box(glow, [0, H - 0.02, D / 2 - 0.02], [W - 0.04, 0.014, 0.03], { outline: false });
    k.box(m(trim, "paint"), [0, 0.09, D / 2 + 0.003], [W - 0.1, 0.03, 0.006], { outline: false });
    // the work surface
    k.box(m(DARK, "metal"), [0, H + 0.006, 0], [W - 0.06, 0.016, D - 0.06], { outline: 0.005 });
    const top = H + 0.014;
    for (const sx of [-1, 1]) {
      const x = sx * 0.9;
      k.box(m("#33333d", "metal"), [x, top + 0.02, 0], [0.62, 0.04, 0.54], { outline: 0.005 });
      k.add("cyl", p.ghost ? m("#141418", "paint") : platterMaterial, [x - 0.04, top + 0.046, 0.02], [0.35, 0.012, 0.35], { outline: false });
      k.add("cyl", m(METAL, "metal"), [x - 0.04, top + 0.058, 0.02], [0.012, 0.016, 0.012], { outline: false });
      // tonearm and pitch fader
      strut(k, m(METAL, "metal"), [x + 0.22, top + 0.06, -0.2], [x + 0.06, top + 0.065, -0.02], 0.012);
      k.box(m("#e8e6ee", "paint"), [x + 0.265, top + 0.05, 0.1], [0.025, 0.02, 0.2], { outline: 0.003 });
      k.box(m(trim, "paint"), [x + 0.265, top + 0.065, 0.12], [0.03, 0.012, 0.04], { outline: false });
      k.add("cyl", glow, [x - 0.22, top + 0.046, -0.2], [0.035, 0.008, 0.035], { outline: false });
    }
    // the mixer: four channels, a crossfader, knobs and level lights
    k.box(m("#2a2a33", "metal"), [0, top + 0.02, 0], [0.46, 0.04, 0.5], { outline: 0.005 });
    for (let i = 0; i < 4; i++) {
      const x = -0.15 + i * 0.1;
      k.box(m("#0b0b0f"), [x, top + 0.042, 0.03], [0.012, 0.004, 0.16], { outline: false });
      k.box(m("#e8e6ee", "paint"), [x, top + 0.05, 0.03 + (i % 2 ? 0.04 : -0.03)], [0.028, 0.014, 0.036], { outline: 0.003 });
      k.add("cyl", glow, [x, top + 0.044, -0.2], [0.03, 0.008, 0.03], { outline: false });
      k.add("cyl", m(i % 2 ? "#c9ccd2" : "#e05a5a", "paint"), [x, top + 0.056, -0.12], [0.038, 0.026, 0.038], { outline: 0.003 });
    }
    k.box(m("#0b0b0f"), [0, top + 0.042, 0.2], [0.26, 0.004, 0.012], { outline: false });
    k.box(m("#e8e6ee", "paint"), [0.04, top + 0.05, 0.2], [0.05, 0.014, 0.032], { outline: 0.003 });
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) k.box(glow, [sx * 0.19, top + 0.043, -0.02 + i * 0.03], [0.014, 0.006, 0.02], { outline: false });
    // a laptop on one end, headphones on the other
    k.box(m("#c4c8c8", "metal"), [-W / 2 + 0.2, top + 0.012, 0.04], [0.28, 0.02, 0.2], { outline: 0.004 });
    k.box(m("#c4c8c8", "metal"), [-W / 2 + 0.2, top + 0.11, -0.07], [0.28, 0.2, 0.012], { rot: [-0.25, 0, 0], outline: 0.004 });
    k.box(glow, [-W / 2 + 0.2, top + 0.11, -0.063], [0.25, 0.17, 0.004], { rot: [-0.25, 0, 0], outline: false });
    k.add(new THREE.TorusGeometry(0.07, 0.012, 8, 20, Math.PI), m("#2a2a33", "paint"), [W / 2 - 0.2, top + 0.075, 0.05], 1, { rot: [0, 0, 0], outline: 0.003, normals: true });
    for (const sx of [-1, 1]) k.add("cyl", m(trim, "paint"), [W / 2 - 0.2 + sx * 0.07, top + 0.04, 0.05], [0.07, 0.035, 0.07], { rot: [0, 0, Math.PI / 2], outline: 0.004 });
  },

  // A laser on a tripod: a boxy head with a lens, fins, and a yoke you can tilt.
  laser: (k, _w, _d, p, m) => {
    const metal = m(str(p, "body", "#2b2b33"), "metal");
    const dark = m(DARK, "metal");
    const top: [number, number, number] = [0, 0.96, 0];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      strut(k, metal, top, [Math.sin(a) * 0.34, 0.03, Math.cos(a) * 0.34], 0.03);
      k.add("sphere", dark, [Math.sin(a) * 0.34, 0.03, Math.cos(a) * 0.34], 0.05, { outline: 0.004 });
    }
    k.add("cyl", dark, [0, 0.96, 0], [0.09, 0.08, 0.09], { outline: 0.004 });
    // yoke arms and the head between them
    for (const s of [-1, 1]) k.box(metal, [s * 0.2, 1.08, 0], [0.03, 0.24, 0.1], { outline: 0.004 });
    k.add("cyl", dark, [-0.225, 1.12, 0], [0.04, 0.02, 0.04], { rot: [0, 0, Math.PI / 2], outline: 0.004 });
    k.box(metal, [0, 1.12, 0], [0.36, 0.2, 0.34], { outline: 0.006 });
    for (let i = 0; i < 4; i++) k.box(dark, [0, 1.16 + i * 0.0, -0.13 + i * 0.002], [0.3, 0.012, 0.04], { outline: false, rot: [0, 0, 0] });
    k.box(dark, [0, 1.12, 0.172], [0.26, 0.15, 0.01], { outline: 0.003 });
    k.add("cyl", lit(p, m), [0, 1.12, 0.18], [0.07, 0.01, 0.07], { rot: [Math.PI / 2, 0, 0], outline: false });
    for (const s of [-1, 1]) k.add("cyl", lit(p, m), [s * 0.085, 1.12, 0.18], [0.03, 0.008, 0.03], { rot: [Math.PI / 2, 0, 0], outline: false });
  },

  // A pair of moving heads hung from a crossbar on a stand (drawn live while the lights are on).
  movinghead: (k, _w, _d, p, m) => {
    const body = str(p, "body", "#2b2b33");
    const metal = m(body, "metal");
    k.add("cyl", metal, [0, 0.03, 0], [0.5, 0.06, 0.5], { outline: 0.005 });
    k.add("cyl8", metal, [0, 0.67, 0], [0.04, 1.2, 0.04], { outline: 0.004 });
    k.box(metal, [0, 1.27, 0], [0.7, 0.04, 0.07], { outline: 0.005 });
    for (const sx of [-1, 1]) k.box(m(DARK, "metal"), [sx * 0.35, 1.27, 0], [0.03, 0.05, 0.08], { outline: 0.004 });
    if (p.inUse) return;
    const glow = lit(p, m);
    for (const [x, z] of HEAD_AT)
      k.at([x, HEAD_Y + 0.08, z], 0, () => {
        headYoke(k, m, body);
        headBody(k, m, glow, body);
      });
  },

  // LED strips on a back plate, standing against a wall: five tall bars of light.
  ledstrip: (k, w, d, p, m) => {
    const plate = m(str(p, "plate", "#23232b"), "paint");
    const z = -d / 2 + 0.03;
    const glow = lit(p, m);
    k.box(plate, [0, 1.05, z], [w - 0.1, 2.1, 0.04], { outline: 0.005 });
    const n = Math.max(3, Math.round((w - 0.3) / 0.2));
    for (let i = 0; i < n; i++) {
      const x = -(w - 0.3) / 2 + ((w - 0.3) * i) / (n - 1);
      k.box(m(DARK, "metal"), [x, 1.05, z + 0.026], [0.07, 1.94, 0.012], { outline: false });
      k.box(glow, [x, 1.05, z + 0.034], [0.04, 1.88, 0.01], { outline: false });
    }
    for (const y of [0.04, 2.08]) k.box(m(METAL, "metal"), [0, y, z + 0.024], [w - 0.1, 0.03, 0.03], { outline: 0.003 });
  },

  // A mirror ball on a pole with an arm over the top (drawn live while the lights are on).
  discoball: (k, _w, _d, p, m) => {
    const metal = m(str(p, "stand", "#2b2b33"), "metal");
    const ball = str(p, "ball", "#cfd3da");
    k.add("cyl", metal, [-0.3, 0.03, 0], [0.4, 0.06, 0.4], { outline: 0.005 });
    k.add("cyl8", metal, [-0.3, 1.25, 0], [0.04, 2.4, 0.04], { outline: 0.004 });
    k.box(metal, [-0.15, 2.45, 0], [0.34, 0.03, 0.04], { outline: 0.004 });
    k.add("cyl", m(METAL, "metal"), [0, 2.36, 0], [0.012, 0.22, 0.012], { outline: false });
    k.add("cyl", m(METAL, "metal"), [0, BALL_Y + 0.2, 0], [0.05, 0.03, 0.05], { outline: 0.003 });
    if (p.inUse) return;
    k.add("sphere", p.ghost ? m(ball, "metal") : mirrorBallMaterial(ball), [0, BALL_Y, 0], 0.42, { outline: 0.006 });
  },

  // A tall party speaker: a lit ring round a deep woofer, a horn tweeter, a handle and corner caps.
  speaker: (k, _w, _d, p, m) => {
    const cab = m(str(p, "body", "#26262e"), "paint");
    const trim = str(p, "trim", "#ff2bd6");
    const glow = lit(p, m);
    const H = 1.18;
    const D = 0.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add("cyl", m(DARK, "rubber"), [sx * 0.24, 0.035, sz * 0.18], [0.07, 0.07, 0.07], { outline: 0.004 });
    k.add("roundbox", cab, [0, 0.07 + H / 2, 0], [0.68, H, D], { outline: 0.008 });
    const front = D / 2;
    // woofer
    k.add("cyl", glow, [0, 0.42, front + 0.004], [0.52, 0.008, 0.52], { rot: [Math.PI / 2, 0, 0], outline: false });
    k.add("cyl", m("#101014", "rubber"), [0, 0.42, front + 0.008], [0.46, 0.012, 0.46], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("cone", m("#1a1a20", "rubber"), [0, 0.42, front + 0.03], [0.34, 0.05, 0.34], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("sphere", m("#2a2a33", "metal"), [0, 0.42, front + 0.052], 0.12, { outline: 0.004 });
    // tweeter
    k.add("cyl", glow, [0, 0.98, front + 0.004], [0.3, 0.008, 0.3], { rot: [Math.PI / 2, 0, 0], outline: false });
    k.add("cyl", m("#101014", "rubber"), [0, 0.98, front + 0.008], [0.26, 0.012, 0.26], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("sphere", m("#2a2a33", "metal"), [0, 0.98, front + 0.03], 0.1, { outline: 0.004 });
    k.box(m(trim, "paint"), [0, 0.7, front + 0.003], [0.5, 0.025, 0.006], { outline: false });
    // handle and corner caps
    for (const sx of [-1, 1]) k.box(m(METAL, "metal"), [sx * 0.09, 1.28, 0], [0.025, 0.04, 0.12], { outline: 0.003 });
    k.box(m(METAL, "metal"), [0, 1.3, 0], [0.2, 0.02, 0.03], { outline: 0.003 });
    for (const sx of [-1, 1]) for (const sy of [0.12, H + 0.02]) k.add("sphere", m(METAL, "metal"), [sx * 0.33, sy, front - 0.04], 0.045, { outline: 0.003 });
  },

  // A music player: a rounded cabinet with a display, a speaker grille, knobs and a play button.
  musicplayer: (k, _w, _d, p, m) => {
    const tone = str(p, "body", "#e05a5a");
    const cab = m(tone, "paint");
    const glow = lit(p, m);
    const D = 0.46;
    k.add("roundbox", cab, [0, 0.55, 0], [0.7, 1.0, D], { outline: 0.008 });
    // an arched top
    k.add("cyl", cab, [0, 1.05, 0], [0.7, 0.2, D], { rot: [0, 0, 0], outline: 0.008 });
    for (const sx of [-1, 1]) k.box(m("#3a3631", "metal"), [sx * 0.27, 0.04, 0.15], [0.07, 0.08, 0.07], { outline: 0.004 });
    const front = D / 2 + 0.004;
    // the display with a glowing line of light, and bars like a level meter
    k.box(m("#101014", "paint"), [0, 0.88, front], [0.5, 0.2, 0.012], { outline: 0.004 });
    k.box(glow, [0, 0.88, front + 0.008], [0.44, 0.14, 0.004], { outline: false });
    for (let i = 0; i < 7; i++) k.box(m("#101014", "paint"), [-0.18 + i * 0.06, 0.86 + (i % 3) * 0.015, front + 0.011], [0.026, 0.05 + (i % 3) * 0.03, 0.002], { outline: false });
    // speaker grille
    k.box(m("#26262e", "paint"), [0, 0.5, front], [0.5, 0.34, 0.012], { outline: 0.004 });
    for (let i = 0; i < 7; i++) k.box(m("#3a3a44", "metal"), [0, 0.38 + i * 0.045, front + 0.008], [0.46, 0.012, 0.004], { outline: false });
    // knobs and the play button
    for (const sx of [-1, 1]) k.add("cyl", m("#efe9df", "paint"), [sx * 0.2, 0.2, front + 0.012], [0.09, 0.03, 0.09], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("cyl", m("#efe9df", "paint"), [0, 0.2, front + 0.012], [0.14, 0.03, 0.14], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("cone", m(tone, "paint"), [0.01, 0.2, front + 0.03], [0.07, 0.04, 0.07], { rot: [Math.PI / 2, 0, -Math.PI / 2], outline: false });
    // a short aerial
    strut(k, m(METAL, "metal"), [0.25, 1.15, -0.05], [0.33, 1.36, -0.1], 0.012);
    k.add("sphere", m(METAL, "metal"), [0.33, 1.37, -0.1], 0.03, { outline: false });
  },
};

export const PARTY_KINDS = Object.keys(PARTY_BUILDERS);
