import * as THREE from "three";
import type { Kit } from "./kit";
import type { Finish } from "./pencil";

/**
 * The furniture expansion: the bigger and more particular pieces (a corner sectional, a desk with its chair, chests
 * and wardrobes, a walk-in shower, garden benches and picnic tables), built like the ones in models.ts: centred on
 * the origin, standing on y = 0 and facing +z, inside the item's footprint (w across x, d across z).
 */

type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Params = Record<string, unknown>;
type Builder = (k: Kit, w: number, d: number, p: Params, m: Mat, seed: number) => void;

const str = (p: Params, key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const INK_DARK = "#4a443d";
const METAL = "#b9b6ae";
const PORCELAIN = "#f4f1ea";

function legs(k: Kit, mat: THREE.Material, w: number, d: number, h: number, r = 0.03, inset = 0.06) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(mat, [sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)], [r * 2, h, r * 2]);
}

/** A row of drawer fronts with a knob each, across a carcass front at `z`. */
function drawers(k: Kit, m: Mat, wood: string, knob: string, x0: number, x1: number, y: number, h: number, z: number, n: number) {
  const span = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + span * (i + 0.5);
    k.box(m(shade(wood, 1.08), "timber"), [x, y, z + 0.006], [span - 0.03, h - 0.03, 0.012], { outline: 0.005 });
    k.add("sphere", m(knob, "metal"), [x, y, z + 0.03], 0.032, { outline: 0.005 });
  }
}

/** A vase of a few round flowers. */
function posy(k: Kit, m: Mat, x: number, y: number, z: number, vase: string, petals: string) {
  k.add("cyl", m(vase, "ceramic"), [x, y + 0.08, z], [0.1, 0.16, 0.1], { outline: 0.005 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    k.add("cyl8", m("#6e934f"), [x + Math.cos(a) * 0.025, y + 0.2, z + Math.sin(a) * 0.025], [0.008, 0.1, 0.008], { outline: false });
    k.add("sphere", m(shade(petals, 0.9 + i * 0.08)), [x + Math.cos(a) * 0.04, y + 0.26 + i * 0.015, z + Math.sin(a) * 0.04], 0.045, { outline: 0.004 });
  }
}

export const FURNITURE_BUILDERS: Record<string, Builder> = {
  // An L: three seats along the back and a chaise out to the front on the right, open in front of the seats.
  sectional: (k, w, d, p, m) => {
    const fabric = str(p, "fabric", "#d8c8ad");
    const fab = m(fabric, "fabric");
    const fabD = m(shade(fabric, 0.86), "fabric");
    const leg = m(str(p, "legs", "#6b4c33"), "timber");
    const W = w - 0.1;
    const D = d - 0.1;
    const back = -D / 2;
    const row = 0.94; // depth of the back row
    const armW = 0.17;
    const chaiseW = 0.92;
    const cx = W / 2 - chaiseW / 2; // middle of the chaise
    // base: the back row and the chaise
    k.add("soft", fabD, [-chaiseW / 2, 0.25, back + row / 2], [W - chaiseW, 0.2, row]);
    k.add("soft", fabD, [cx, 0.25, 0], [chaiseW, 0.2, D]);
    for (const [x, z] of [[-W / 2 + 0.06, back + 0.06], [-W / 2 + 0.06, back + row - 0.06], [W / 2 - 0.06, back + 0.06], [W / 2 - 0.06, D / 2 - 0.06], [cx - chaiseW / 2 + 0.06, D / 2 - 0.06]] as const)
      k.box(leg, [x, 0.075, z], [0.05, 0.15, 0.05]);
    // seat cushions along the back row, and one long one on the chaise
    const seatX0 = -W / 2 + armW;
    const seatX1 = cx - chaiseW / 2;
    const seats = 2;
    const cw = (seatX1 - seatX0) / seats;
    for (let i = 0; i < seats; i++) k.add("soft", fab, [seatX0 + cw * (i + 0.5), 0.42, back + row / 2 + 0.08], [cw - 0.02, 0.15, row - 0.22]);
    k.add("soft", fab, [cx - 0.04, 0.42, 0.06], [chaiseW - 0.12, 0.15, D - 0.26]);
    // back along the whole back, with cushions leaning on it
    k.add("soft", fabD, [0, 0.6, back + 0.09], [W, 0.58, 0.18]);
    for (let i = 0; i < seats; i++) k.add("soft", fab, [seatX0 + cw * (i + 0.5), 0.66, back + 0.25], [cw - 0.04, 0.42, 0.16], { rot: [-0.14, 0, 0] });
    k.add("soft", fab, [cx - 0.04, 0.66, back + 0.25], [chaiseW - 0.16, 0.42, 0.16], { rot: [-0.14, 0, 0] });
    // arms: one at the left end, one down the outside of the chaise
    k.add("soft", fabD, [-W / 2 + armW / 2, 0.47, back + row / 2 + 0.01], [armW, 0.34, row - 0.02]);
    k.add("soft", fab, [-W / 2 + armW / 2, 0.65, back + row / 2 + 0.02], [armW + 0.02, 0.06, row - 0.04]);
    k.add("soft", fabD, [W / 2 - armW / 2 + 0.02, 0.47, 0.02], [armW - 0.04, 0.34, D - 0.02]);
    // throw pillows in the corner and a folded blanket on the chaise
    k.add("soft", m(shade(fabric, 1.18), "fabric"), [-W / 2 + armW + 0.2, 0.62, back + 0.38], [0.34, 0.32, 0.11], { rot: [-0.3, 0.35, 0.12] });
    k.add("soft", m(str(p, "pillow", "#e9c46a"), "fabric"), [cx - 0.24, 0.62, back + 0.38], [0.32, 0.3, 0.11], { rot: [-0.3, -0.3, -0.1] });
    k.add("soft", m(str(p, "throw", "#efe6d2"), "fabric"), [cx - 0.04, 0.52, D / 2 - 0.3], [chaiseW - 0.14, 0.05, 0.36]);
  },

  // A writing desk against the back, a drawer pedestal on one side, and its chair tucked in at the front.
  desk: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#b98a5a");
    const body = m(wood, "timber");
    const W = w - 0.16;
    const D = 0.55;
    const z = -d / 2 + 0.04 + D / 2;
    const H = 0.74;
    k.box(body, [0, H - 0.02, z], [W, 0.04, D]);
    // a pedestal of drawers on the right, two legs on the left, a modesty panel between
    const pw = 0.42;
    const px = W / 2 - pw / 2 - 0.02;
    k.box(body, [px, (H - 0.04) / 2, z], [pw, H - 0.04, D - 0.04]);
    for (let i = 0; i < 3; i++) drawers(k, m, wood, METAL, px - pw / 2 + 0.02, px + pw / 2 - 0.02, 0.14 + i * 0.2, 0.2, z + D / 2 - 0.02, 1);
    for (const sz of [-1, 1]) k.box(body, [-W / 2 + 0.05, (H - 0.04) / 2, z + sz * (D / 2 - 0.05)], [0.05, H - 0.04, 0.05]);
    k.box(m(shade(wood, 0.88), "timber"), [-0.1, H - 0.2, z - D / 2 + 0.03], [W - pw - 0.2, 0.3, 0.02]);
    // on top: an open laptop, a lamp, a mug of pencils, a notebook
    const top = H;
    k.box(m("#c4c8c8", "metal"), [-0.18, top + 0.01, z + 0.06], [0.34, 0.02, 0.24], { outline: 0.005 });
    k.at([-0.18, top + 0.02, z - 0.06], [-0.32, 0, 0], () => {
      k.box(m("#c4c8c8", "metal"), [0, 0.12, 0], [0.34, 0.24, 0.015], { outline: 0.005 });
      k.box(m("#56646b"), [0, 0.125, 0.009], [0.3, 0.2, 0.002], { outline: false });
    });
    const lamp = m(str(p, "lamp", "#3d4246"), "metal");
    k.add("cyl", lamp, [W / 2 - 0.16, top + 0.015, z - 0.12], [0.14, 0.03, 0.14]);
    k.add("cyl8", lamp, [W / 2 - 0.16, top + 0.2, z - 0.12], [0.02, 0.36, 0.02]);
    k.add("cone", lamp, [W / 2 - 0.2, top + 0.38, z - 0.06], [0.14, 0.12, 0.14], { rot: [0.6, 0, 0.3] });
    k.add("cyl", m(PORCELAIN, "ceramic"), [0.2, top + 0.05, z - 0.14], [0.08, 0.1, 0.08], { outline: 0.005 });
    for (let i = 0; i < 3; i++) k.add("cyl8", m(["#d9b45a", "#a6564a", "#5d7f8f"][i]!), [0.19 + i * 0.012, top + 0.13, z - 0.14 + (i - 1) * 0.012], [0.012, 0.14, 0.012], { rot: [0, 0, (i - 1) * 0.15], outline: false });
    k.box(m("#e07a5f", "paper"), [0.3, top + 0.01, z + 0.08], [0.16, 0.02, 0.22], { rot: [0, 0.2, 0], outline: 0.005 });
    // the chair, facing the desk (towards -z), its back at the front
    const chair = m(str(p, "chair", wood), "timber");
    const seat = m(str(p, "seat", "#d9c7a7"), "fabric");
    const cz = d / 2 - 0.28;
    const S = 0.42;
    k.at([0, 0, cz], 0, () => {
      legs(k, chair, S, S, 0.44, 0.02, 0.03);
      k.box(chair, [0, 0.45, 0], [S, 0.04, S]);
      k.add("soft", seat, [0, 0.49, -0.01], [S - 0.05, 0.05, S - 0.06]);
      for (const sx of [-1, 1]) k.box(chair, [sx * (S / 2 - 0.03), 0.7, S / 2 - 0.02], [0.04, 0.48, 0.04]);
      k.box(chair, [0, 0.86, S / 2 - 0.02], [S - 0.02, 0.14, 0.03], { outline: 0.005 });
    });
  },

  // A wide chest of drawers on short legs, with a mirror-less top: a vase, a photo and a little box.
  dresser: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#b98a5a");
    const body = m(wood, "timber");
    const W = Math.min(w - 0.2, 1.5);
    const D = 0.48;
    const z = -d / 2 + 0.04 + D / 2;
    const H = 0.88;
    k.at([0, 0, z], 0, () => legs(k, m(shade(wood, 0.8), "timber"), W - 0.04, D - 0.04, 0.12, 0.025, 0.05));
    k.box(body, [0, 0.12 + (H - 0.12) / 2, z], [W, H - 0.12, D]);
    k.box(m(shade(wood, 0.92), "timber"), [0, H + 0.015, z], [W + 0.04, 0.03, D + 0.03]);
    const knob = str(p, "knob", "#c9a35c");
    const rows = [0.25, 0.48, 0.71];
    for (const [i, y] of rows.entries()) drawers(k, m, wood, knob, -W / 2 + 0.04, W / 2 - 0.04, y, i === 0 ? 0.24 : 0.22, z + D / 2, 2);
    // things on top
    posy(k, m, -W / 2 + 0.22, H + 0.03, z - 0.04, str(p, "vase", "#8fa7c4"), "#f2dca8");
    k.at([0.12, H + 0.03, z - 0.08], 0.15, () => {
      k.box(m("#3d4246", "timber"), [0, 0.11, 0], [0.18, 0.22, 0.02], { rot: [-0.18, 0, 0], outline: 0.005 });
      k.box(m("#e3b5a4", "paper"), [0, 0.11, 0.012], [0.13, 0.16, 0.004], { rot: [-0.18, 0, 0], outline: false });
    });
    k.box(m("#a6564a", "timber"), [W / 2 - 0.2, H + 0.07, z + 0.02], [0.2, 0.08, 0.14], { outline: 0.005 });
  },

  // A tall two-door wardrobe on a plinth, with a crown along the top and a hatbox on it.
  wardrobe: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#b98a5a");
    const body = m(wood, "timber");
    const panel = m(shade(wood, 1.08), "timber");
    const W = Math.min(w - 0.16, 1.6);
    const D = 0.58;
    const z = -d / 2 + 0.03 + D / 2;
    const H = 2.0;
    k.box(m(shade(wood, 0.8), "timber"), [0, 0.05, z], [W - 0.04, 0.1, D - 0.04]);
    k.box(body, [0, 0.1 + (H - 0.1) / 2, z], [W, H - 0.1, D]);
    k.box(body, [0, H + 0.03, z + 0.01], [W + 0.06, 0.06, D + 0.04]);
    const front = z + D / 2;
    const handle = m(str(p, "handle", "#c9a35c"), "metal");
    for (const s of [-1, 1]) {
      const x = s * (W / 4);
      k.box(panel, [x, 1.05, front + 0.006], [W / 2 - 0.04, 1.84, 0.012], { outline: 0.006 });
      // two sunk panels on each door
      for (const [y, h] of [[1.4, 0.9], [0.55, 0.62]] as const) k.box(m(shade(wood, 0.95), "timber"), [x, y, front + 0.014], [W / 2 - 0.2, h, 0.006], { outline: 0.004 });
      k.box(handle, [s * 0.05, 1.05, front + 0.03], [0.02, 0.22, 0.025], { outline: 0.005 });
    }
    // a hatbox on top
    k.add("cyl", m(str(p, "box", "#e3b5a4"), "paper"), [-W / 4, H + 0.15, z], [0.38, 0.18, 0.38]);
    k.add("cyl", m("#fbf7ec", "paper"), [-W / 4, H + 0.245, z], [0.4, 0.02, 0.4], { outline: 0.005 });
  },

  // A walk-in shower: a tray, a tiled wall at the back with the shower on it, glass down both sides.
  shower: (k, w, d, p, m) => {
    const tile = str(p, "tile", "#f2f0ea");
    const trim = m(str(p, "trim", METAL), "metal");
    const W = w - 0.08;
    const D = d - 0.08;
    const H = 2.15;
    k.box(m(PORCELAIN, "ceramic"), [0, 0.04, 0], [W, 0.08, D]);
    k.box(m("#d6dcdc", "ceramic"), [0, 0.081, 0], [W - 0.1, 0.004, D - 0.1], { outline: false });
    k.add("cyl", m(METAL, "metal"), [0, 0.085, 0], [0.08, 0.004, 0.08], { outline: false });
    // the back wall, with tile lines across it
    const back = -D / 2 + 0.04;
    k.box(m(tile, "ceramic"), [0, H / 2 + 0.04, back], [W, H, 0.08]);
    const line = m(shade(tile, 0.85));
    for (let y = 0.3; y < H; y += 0.25) k.box(line, [0, y, back + 0.041], [W - 0.02, 0.008, 0.002], { outline: false });
    for (let x = -W / 2 + 0.15; x < W / 2; x += 0.3) k.box(line, [x, H / 2 + 0.04, back + 0.041], [0.008, H - 0.02, 0.002], { outline: false });
    // glass down both sides, held top and bottom
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.015);
      k.box(m("#cfe6ee", undefined, 0.16), [x, H / 2 + 0.1, 0.02], [0.012, H - 0.1, D - 0.1], { outline: false });
      k.box(trim, [x, H + 0.06, 0.02], [0.03, 0.03, D - 0.1], { outline: 0.004 });
      k.box(trim, [x, 0.1, 0.02], [0.03, 0.03, D - 0.1], { outline: 0.004 });
    }
    // the riser, its arm, a rain head, a mixer and a soap shelf
    k.add("cyl8", trim, [0.24, 1.2, back + 0.07], [0.03, 1.5, 0.03], { outline: 0.004 });
    k.box(trim, [0, 1.98, back + 0.15], [0.03, 0.03, 0.22], { outline: 0.004 });
    k.add("cyl", trim, [0, 1.95, back + 0.26], [0.24, 0.03, 0.24], { outline: 0.005 });
    k.add("cyl", trim, [0.24, 1.05, back + 0.08], [0.08, 0.04, 0.08], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.box(m(shade(tile, 0.92), "ceramic"), [-0.26, 1.1, back + 0.09], [0.24, 0.025, 0.1], { outline: 0.004 });
    k.box(m("#e9c46a"), [-0.3, 1.14, back + 0.09], [0.08, 0.05, 0.05], { outline: 0.004 });
    k.add("cyl", m("#9fb7a8"), [-0.2, 1.17, back + 0.09], [0.05, 0.12, 0.05], { outline: 0.004 });
    // a towel over the side glass
    k.box(m(str(p, "towel", "#e3b5a4"), "fabric"), [W / 2 + 0.002, 1.95, D / 2 - 0.3], [0.05, 0.4, 0.3], { outline: 0.005 });
  },

  // A full-length mirror on a stand, tilted back a little.
  mirror: (k, _w, _d, p, m) => {
    const frame = m(str(p, "frame", "#b98a5a"), "timber");
    const H = 1.6;
    const W = 0.56;
    for (const s of [-1, 1]) {
      k.box(frame, [s * (W / 2 + 0.05), 0.85, 0], [0.05, 1.7, 0.05]);
      k.box(frame, [s * (W / 2 + 0.05), 0.02, 0], [0.06, 0.04, 0.5]);
    }
    k.at([0, 0.95, 0], 0, () => {
      k.box(frame, [0, 0, 0], [W + 0.06, H + 0.06, 0.04], { rot: [-0.08, 0, 0] });
      k.box(m("#d9e6ea", "glass"), [0, 0, 0.024], [W - 0.04, H - 0.04, 0.008], { rot: [-0.08, 0, 0], outline: false });
      // a glint across the glass
      k.box(m("#ffffff", "glass", 0.7), [-0.1, 0.3, 0.03], [0.04, 0.5, 0.002], { rot: [-0.08, 0, 0.5], outline: false });
      k.box(m("#ffffff", "glass", 0.7), [-0.02, 0.32, 0.03], [0.015, 0.4, 0.002], { rot: [-0.08, 0, 0.5], outline: false });
    });
    for (const s of [-1, 1]) k.add("sphere", m(METAL, "metal"), [s * (W / 2 + 0.03), 0.95, 0], 0.03, { outline: 0.004 });
  },

  // A slatted garden bench with arms, on cast iron ends.
  bench: (k, w, d, p, m) => {
    const wood = m(str(p, "wood", "#b98a5a"), "timber");
    const iron = m(str(p, "frame", "#3d4246"), "metal");
    const W = w - 0.16;
    const D = 0.5;
    const z = -d / 2 + 0.2 + D / 2;
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.04);
      k.box(iron, [x, 0.22, z + 0.18], [0.05, 0.44, 0.05]);
      k.box(iron, [x, 0.425, z - 0.22], [0.05, 0.84, 0.05], { rot: [-0.08, 0, 0] });
      k.box(iron, [x, 0.4, z - 0.02], [0.04, 0.04, D - 0.04]);
      // the arm
      k.box(iron, [x, 0.52, z + 0.18], [0.04, 0.16, 0.04]);
      k.box(wood, [x, 0.62, z - 0.01], [0.08, 0.04, D - 0.02]);
    }
    for (let i = 0; i < 4; i++) k.box(wood, [0, 0.44, z - D / 2 + 0.07 + i * 0.12], [W - 0.08, 0.035, 0.09]);
    for (let i = 0; i < 3; i++) k.box(wood, [0, 0.58 + i * 0.13, z - D / 2 + 0.01 - i * 0.012], [W - 0.08, 0.09, 0.03], { rot: [-0.08, 0, 0] });
  },

  // A picnic table with its benches joined on, on splayed A-frame legs.
  picnic: (k, w, d, p, m) => {
    const tone = str(p, "wood", "#b98a5a");
    const wood = m(tone, "timber");
    const dark = m(shade(tone, 0.85), "timber");
    const W = w - 0.16;
    const H = 0.74;
    const benchZ = d / 2 - 0.36;
    // table top in planks
    for (let i = 0; i < 5; i++) k.box(wood, [0, H - 0.02, -0.32 + i * 0.16], [W, 0.04, 0.15]);
    // bench seats, two planks each
    for (const s of [-1, 1]) for (const dz of [-0.07, 0.07]) k.box(wood, [0, 0.44, s * benchZ + dz], [W, 0.035, 0.13]);
    // the A-frames: two splayed legs under the top, a cross bar carrying the benches
    for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) {
      k.box(dark, [x, 0.42, 0], [0.06, 0.06, benchZ * 2 + 0.2]);
      k.box(dark, [x, H - 0.07, 0], [0.06, 0.06, 0.78]);
      for (const s of [-1, 1]) k.box(dark, [x, (H - 0.04) / 2, s * 0.24], [0.06, H - 0.02, 0.07], { rot: [-s * 0.42, 0, 0] });
    }
    // a gingham cloth and a jug of lemonade
    k.box(m(str(p, "cloth", "#e07a5f"), "fabric"), [0, H + 0.003, 0], [0.6, 0.006, 0.6], { rot: [0, 0.3, 0], outline: 0.004 });
    k.add("cyl", m("#f6e7a8", "glass", 0.85), [0.1, H + 0.1, 0.04], [0.12, 0.2, 0.12], { outline: 0.005 });
  },

  // An arc floor lamp: a heavy round base, a stem curving over, a dome shade hanging from its end.
  arclamp: (k, _w, _d, p, m) => {
    const metal = m(str(p, "metal", "#c9a35c"), "metal");
    k.add("cyl", m(str(p, "base", "#e4ddcf"), "mineral"), [-0.26, 0.04, 0], [0.3, 0.08, 0.3]);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * Math.PI * 0.62;
      pts.push(new THREE.Vector3(-0.26 + (1 - Math.cos(t)) * 0.4, 0.08 + Math.sin(t) * 1.75, 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    k.add(new THREE.TubeGeometry(curve, 24, 0.016, 6), metal, [0, 0, 0], 1, { outline: 0.004, normals: true });
    const end = pts[pts.length - 1]!;
    k.add("half", m(str(p, "shade", "#f6f0e2"), "metal"), [end.x, end.y - 0.18, 0], [0.4, 0.2, 0.4], { normals: true });
    k.add("sphere", m("#fff6d8"), [end.x, end.y - 0.2, 0], 0.07, { outline: false });
  },

  // A round rug with a border ring and a smaller ring inside.
  roundrug: (k, w, d, p, m) => {
    const R = Math.min(w, d) - 0.15;
    const color = str(p, "color", "#efe6d2");
    const border = str(p, "border", "#c9785d");
    k.add("cyl", m(border, "carpet"), [0, 0.008, 0], [R, 0.012, R], { outline: 0.006, normals: true });
    k.add("cyl", m(color, "carpet"), [0, 0.012, 0], [R - 0.16, 0.012, R - 0.16], { outline: false });
    k.add("cyl", m(border, "carpet"), [0, 0.016, 0], [R * 0.5, 0.012, R * 0.5], { outline: false });
    k.add("cyl", m(color, "carpet"), [0, 0.02, 0], [R * 0.5 - 0.1, 0.012, R * 0.5 - 0.1], { outline: false });
    k.add("cyl", m(str(p, "middle", border), "carpet"), [0, 0.024, 0], [R * 0.16, 0.012, R * 0.16], { outline: false });
  },
};

/** The kinds above, so tests can check each is used. */
export const FURNITURE_KINDS = Object.keys(FURNITURE_BUILDERS);
