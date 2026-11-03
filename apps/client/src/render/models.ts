import type { FurnitureItem, OpeningItem } from "@cg/shared";
import * as THREE from "three";
import { Kit, type BuiltMesh } from "./kit";
import { pencilMaterial, type Finish } from "./pencil";

/**
 * Furniture models, drawn from each catalog item's `model` description. A builder gets the item's footprint in
 * metres (width along x, depth along z), its model params, and a material maker, and builds the piece centred on
 * the origin, standing on y = 0 and facing +z. New catalog items reuse these by kind with their own colours.
 */

type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Params = Record<string, unknown>;
type Builder = (k: Kit, w: number, d: number, p: Params, m: Mat, seed: number) => void;

const str = (p: Params, key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);
const num = (p: Params, key: string, fallback: number) => (typeof p[key] === "number" ? (p[key] as number) : fallback);

/** Lighten (f > 1) or darken (f < 1) a hex colour. */
export function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
    .toString(16)
    .padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Small deterministic random numbers, so a bookshelf's books look the same for both players. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** An eight-panel parasol canopy. */
const CANOPY = new THREE.ConeGeometry(0.5, 1, 8, 1, true);

const INK_DARK = "#4a443d";
const METAL = "#b9b6ae";
const PORCELAIN = "#f4f1ea";

function legs(k: Kit, mat: THREE.Material, w: number, d: number, h: number, r = 0.035, inset = 0.08, shape: "cyl" | "box" = "cyl") {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(shape, mat, [sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)], [r * 2, h, r * 2]);
}

function knob(k: Kit, m: Mat, x: number, y: number, z: number) {
  k.add("sphere", m(METAL), [x, y, z], 0.035, { outline: 0.006 });
}

const sofaLike = (seatsOverride?: number): Builder => (k, w, d, p, m) => {
  const fabric = str(p, "fabric", "#c9785d");
  const fab = m(fabric, "fabric");
  const fabD = m(shade(fabric, 0.86), "fabric");
  const leg = m(str(p, "legs", "#6b4c33"), "wood");
  const W = w - 0.12;
  const D = d - 0.14;
  const armW = 0.17;
  const inner = W - armW * 2;
  const seats = seatsOverride ?? Math.max(2, Math.round(inner / 0.62));
  const cw = inner / seats;
  legs(k, leg, W - 0.04, D - 0.04, 0.12, 0.028);
  k.add("soft", fabD, [0, 0.25, 0], [W, 0.2, D]);
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    k.add("soft", fab, [x, 0.42, 0.07], [cw - 0.02, 0.15, D - 0.24]);
    k.add("soft", fab, [x, 0.66, -D / 2 + 0.24], [cw - 0.04, 0.42, 0.16], { rot: [-0.14, 0, 0] });
  }
  k.add("soft", fabD, [0, 0.6, -D / 2 + 0.09], [W, 0.58, 0.18]);
  for (const s of [-1, 1]) {
    k.add("soft", fabD, [s * (W / 2 - armW / 2), 0.47, 0.02], [armW, 0.34, D - 0.02]);
    k.add("soft", fab, [s * (W / 2 - armW / 2), 0.65, 0.04], [armW + 0.02, 0.06, D - 0.04]);
  }
  // a throw pillow, and on bigger sofas a folded blanket over one arm
  k.add("soft", m(shade(fabric, 1.25), "fabric"), [-inner / 2 + 0.2, 0.62, -D / 2 + 0.38], [0.34, 0.32, 0.11], { rot: [-0.3, 0.35, 0.12] });
  if (seats >= 3) k.add("soft", m("#efe6d2", "fabric"), [W / 2 - armW / 2, 0.7, 0.05], [armW + 0.06, 0.05, 0.5]);
};

const BUILDERS: Record<string, Builder> = {
  sofa: sofaLike(),
  armchair: sofaLike(1),

  table: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#b98a5a");
    const top = m(wood, "wood");
    const legM = m(shade(wood, 0.85), "wood");
    const h = num(p, "height", 0.75);
    const inset = num(p, "inset", 0.06);
    const W = w - inset * 2;
    const D = d - inset * 2 - (h < 0.5 ? 0.1 : 0);
    k.box(top, [0, h - 0.025, 0], [W, 0.05, D]);
    k.box(legM, [0, h - 0.08, 0], [W - 0.12, 0.07, D - 0.12]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add("cone", legM, [sx * (W / 2 - 0.08), (h - 0.05) / 2, sz * (D / 2 - 0.08)], [0.06, h - 0.05, 0.06], { rot: [Math.PI, 0, 0] });
    if (h < 0.5) {
      // coffee table: a lower shelf and a stack of books with a mug
      k.box(top, [0, 0.12, 0], [W - 0.16, 0.03, D - 0.12]);
      if (p.books) {
        const colors = ["#a6564a", "#5d7f8f", "#d9b45a"];
        colors.forEach((c, i) => k.box(m(c), [-W / 4, h + 0.02 + i * 0.035, 0], [0.28 - i * 0.03, 0.033, 0.2 - i * 0.02], { rot: [0, i * 0.25 - 0.2, 0], outline: 0.006 }));
        k.add("cyl", m(PORCELAIN), [W / 4, h + 0.05, 0.04], [0.08, 0.1, 0.08], { outline: 0.006 });
        k.add("torus", m(PORCELAIN), [W / 4 + 0.05, h + 0.05, 0.04], [0.04, 0.04, 0.04], { rot: [0, 0, Math.PI / 2], outline: false });
      }
    } else {
      // dining table: a runner and a small vase
      k.box(m("#e8dcc4", "fabric"), [0, h + 0.003, 0], [W * 0.7, 0.006, 0.28], { outline: 0.004 });
      k.add("cyl", m("#8fa7c4"), [0, h + 0.09, 0], [0.09, 0.18, 0.09], { outline: 0.006 });
      k.add("blob", m("#e9a07c"), [0, h + 0.22, 0], [0.14, 0.1, 0.14], { outline: 0.006 });
    }
  },

  chair: (k, w, d, p, m) => {
    const wood = m(str(p, "wood", "#a57a50"), "wood");
    const seat = m(str(p, "seat", "#d9c7a7"), "fabric");
    const S = Math.min(w, d) * 0.46;
    legs(k, wood, S, S, 0.45, 0.022, 0.03, "box");
    k.box(wood, [0, 0.46, 0], [S, 0.04, S]);
    k.add("soft", seat, [0, 0.5, 0.01], [S - 0.05, 0.05, S - 0.06]);
    for (const sx of [-1, 1]) k.box(wood, [sx * (S / 2 - 0.03), 0.72, -S / 2 + 0.02], [0.04, 0.5, 0.04]);
    for (let i = 0; i < 3; i++) k.box(wood, [0, 0.62 + i * 0.12, -S / 2 + 0.02], [S - 0.06, 0.05, 0.025]);
  },

  tvstand: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#8c6646");
    const body = m(wood, "wood");
    const W = w - 0.2;
    const D = 0.45;
    const z = -d / 2 + D / 2 + 0.04;
    k.at([0, 0, z], 0, () => legs(k, m(shade(wood, 0.7)), W, D, 0.1, 0.02, 0.06));
    k.box(body, [0, 0.33, z], [W, 0.46, D]);
    for (let i = 0; i < 3; i++) {
      const x = -W / 2 + (W / 3) * (i + 0.5);
      k.box(m(shade(wood, 1.08), "wood"), [x, 0.33, z + D / 2 + 0.005], [W / 3 - 0.04, 0.38, 0.01], { outline: 0.006 });
      knob(k, m, x, 0.46, z + D / 2 + 0.02);
    }
    // the TV
    k.box(m(INK_DARK), [0, 0.6, z - 0.02], [0.32, 0.04, 0.16]);
    k.box(m(INK_DARK), [0, 0.7, z - 0.02], [0.05, 0.18, 0.04]);
    k.box(m("#3d4246"), [0, 1.08, z], [W * 0.75, 0.62, 0.05]);
    k.box(m("#56646b"), [0, 1.08, z + 0.026], [W * 0.75 - 0.05, 0.57, 0.004], { outline: false });
    // a little plant on the end
    k.add("cyl", m("#c87f5a"), [W / 2 - 0.15, 0.64, z], [0.14, 0.14, 0.14]);
    k.add("blob", m("#7fa36a"), [W / 2 - 0.15, 0.78, z], [0.22, 0.18, 0.22]);
  },

  bookshelf: (k, w, d, p, m, seed) => {
    const wood = str(p, "wood", "#a57a50");
    const frame = m(wood, "wood");
    const back = m(shade(wood, 0.8), "wood");
    const W = w - 0.12;
    const D = 0.34;
    const H = 1.9;
    const z = -d / 2 + D / 2 + 0.03;
    k.box(back, [0, H / 2, z - D / 2 + 0.01], [W, H, 0.02]);
    for (const s of [-1, 1]) k.box(frame, [s * (W / 2 - 0.02), H / 2, z], [0.04, H, D]);
    const shelves = 5;
    const r = rng(seed);
    const palette = ["#a6564a", "#5d7f8f", "#d9b45a", "#7f9a6a", "#8a6a9a", "#e2d5bb", "#c47f4e"];
    for (let i = 0; i <= shelves; i++) {
      const y = 0.06 + (i * (H - 0.08)) / shelves;
      k.box(frame, [0, y, z], [W - 0.04, 0.035, D]);
      if (i === shelves) continue;
      let x = -W / 2 + 0.06;
      while (x < W / 2 - 0.12) {
        const bw = 0.03 + r() * 0.035;
        const bh = 0.2 + r() * 0.1;
        if (r() < 0.12) {
          x += 0.08;
          continue;
        }
        const lean = r() < 0.08 ? 0.25 : 0;
        k.box(m(palette[Math.floor(r() * palette.length)]!), [x + bw / 2, y + 0.02 + bh / 2, z + 0.02], [bw, bh, D - 0.08], { rot: [0, 0, lean], outline: 0.005 });
        x += bw + 0.004 + (lean ? 0.05 : 0);
      }
    }
  },

  lamp: (k, _w, _d, p, m) => {
    const metal = m("#6f6a60");
    k.add("cyl", metal, [0, 0.02, 0], [0.32, 0.04, 0.32]);
    k.add("cyl8", metal, [0, 0.8, 0], [0.03, 1.56, 0.03]);
    k.add("cone", m(str(p, "shade", "#f2dca8"), "fabric"), [0, 1.58, 0], [0.42, 0.34, 0.42]);
    k.add("sphere", m("#fff6d8"), [0, 1.45, 0], 0.07, { outline: false });
  },

  plant: (k, _w, _d, p, m, seed) => {
    const pot = str(p, "pot", "#c87f5a");
    k.add("cone", m(pot), [0, 0.2, 0], [0.42, 0.4, 0.42], { rot: [Math.PI, 0, 0] });
    k.add("torus", m(shade(pot, 0.9)), [0, 0.4, 0], [0.42, 0.42, 0.42], { rot: [Math.PI / 2, 0, 0], outline: false });
    k.add("cyl", m("#6b5141"), [0, 0.39, 0], [0.38, 0.02, 0.38], { outline: false });
    const trunk = m("#7a5c43");
    k.add("cyl8", trunk, [0, 0.85, 0], [0.04, 0.9, 0.04]);
    const r = rng(seed);
    const leaves = str(p, "leaves", "#7fa36a");
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const y = 0.7 + r() * 0.85;
      const rad = 0.08 + (1 - (y - 0.7) / 0.85) * 0.18 + r() * 0.06;
      k.add("blob", m(shade(leaves, 0.85 + r() * 0.3)), [Math.cos(a) * rad, y, Math.sin(a) * rad], [0.2, 0.06, 0.13], { rot: [r() * 0.6 - 0.3, a, 0.4 + r() * 0.4], outline: 0.008 });
    }
  },

  rug: (k, w, d, p, m) => {
    const color = str(p, "color", "#d7a86e");
    const border = str(p, "border", "#9c4f3c");
    const W = w - 0.15;
    const D = d - 0.15;
    k.box(m(border, "carpet"), [0, 0.008, 0], [W, 0.012, D], { outline: 0.006, normals: true });
    k.box(m(color, "carpet"), [0, 0.012, 0], [W - 0.16, 0.012, D - 0.16], { outline: false });
    k.box(m(border, "carpet"), [0, 0.016, 0], [W - 0.5, 0.012, 0.06], { outline: false });
    k.box(m(border, "carpet"), [0, 0.016, 0], [0.06, 0.012, D - 0.5], { outline: false });
    // fringe at the short ends
    for (const s of [-1, 1]) for (let i = 0; i < Math.floor(D / 0.06); i++) k.box(m("#efe6d2"), [s * (W / 2 + 0.03), 0.004, -D / 2 + 0.03 + i * 0.06], [0.06, 0.006, 0.015], { outline: false });
  },

  bed: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#a57a50");
    const frame = m(wood, "wood");
    const W = w - 0.14;
    const D = d - 0.1;
    legs(k, m(shade(wood, 0.8), "wood"), W, D, 0.14, 0.03, 0.05, "box");
    k.box(frame, [0, 0.22, 0.03], [W, 0.16, D - 0.08]);
    // headboard with panels
    k.box(frame, [0, 0.55, -D / 2 + 0.04], [W, 1.0, 0.07]);
    for (let i = 0; i < 3; i++) k.box(m(shade(wood, 1.08), "wood"), [-W / 3 + (i * W) / 3, 0.62, -D / 2 + 0.08], [W / 3 - 0.08, 0.5, 0.012], { outline: 0.006 });
    k.box(frame, [0, 0.3, D / 2 - 0.03], [W, 0.32, 0.06]);
    k.add("soft", m("#f3eee3", "fabric"), [0, 0.37, 0.02], [W - 0.08, 0.2, D - 0.18]);
    const blanket = str(p, "blanket", "#8fa7c4");
    k.add("soft", m(blanket, "fabric"), [0, 0.47, 0.22], [W - 0.04, 0.06, D * 0.62]);
    k.add("soft", m(shade(blanket, 0.85), "fabric"), [0, 0.5, 0.22 - D * 0.31 + 0.06], [W - 0.03, 0.07, 0.14]);
    const pillow = m(str(p, "pillow", "#f6f0e2"), "fabric");
    for (const s of [-1, 1]) k.add("soft", pillow, [s * (W / 4), 0.52, -D / 2 + 0.3], [W / 2 - 0.14, 0.14, 0.34], { rot: [-0.2, 0, 0] });
  },

  nightstand: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#a57a50");
    const body = m(wood, "wood");
    const z = -d / 2 + 0.28;
    k.at([0, 0, z], 0, () => legs(k, m(shade(wood, 0.8)), 0.48, 0.42, 0.08, 0.02, 0.04));
    k.box(body, [0, 0.33, z], [0.48, 0.5, 0.42]);
    for (let i = 0; i < 2; i++) {
      k.box(m(shade(wood, 1.08), "wood"), [0, 0.22 + i * 0.22, z + 0.215], [0.42, 0.18, 0.012], { outline: 0.006 });
      knob(k, m, 0, 0.22 + i * 0.22, z + 0.23);
    }
    // a small lamp and a book
    k.add("cyl", m("#8fa7c4"), [0.1, 0.66, z - 0.04], [0.1, 0.14, 0.1]);
    k.add("cone", m("#f2dca8", "fabric"), [0.1, 0.82, z - 0.04], [0.22, 0.16, 0.22]);
    k.box(m("#a6564a"), [-0.1, 0.6, z + 0.05], [0.16, 0.03, 0.22], { rot: [0, 0.3, 0], outline: 0.005 });
  },

  counter: (k, w, d, p, m) => {
    const cab = str(p, "cabinet", "#9fb7a8");
    const D = 0.62;
    const z = -d / 2 + D / 2;
    const W = w;
    k.box(m(INK_DARK), [0, 0.05, z - 0.03], [W - 0.04, 0.1, D - 0.06]);
    k.box(m(cab, "wood"), [0, 0.48, z - 0.01], [W, 0.76, D - 0.02]);
    for (const s of [-1, 1]) {
      k.box(m(shade(cab, 1.07), "wood"), [s * (W / 4), 0.48, z + D / 2 - 0.01], [W / 2 - 0.04, 0.68, 0.015], { outline: 0.006 });
      k.box(m(METAL), [s * 0.06, 0.7, z + D / 2 + 0.01], [0.015, 0.14, 0.02], { outline: 0.005 });
    }
    k.box(m(str(p, "top", "#e9e3d6"), "stone"), [0, 0.885, z + 0.01], [W, 0.05, D + 0.02]);
    if (p.sink) {
      k.box(m("#c9ccc8"), [0, 0.9, z + 0.03], [0.5, 0.012, 0.36], { outline: 0.006 });
      k.box(m("#9aa3a3"), [0, 0.905, z + 0.03], [0.44, 0.01, 0.3], { outline: false });
      const steel = m(METAL);
      k.add("cyl", steel, [0, 0.98, z - D / 2 + 0.08], [0.04, 0.18, 0.04], { outline: 0.006 });
      k.box(steel, [0, 1.07, z - D / 2 + 0.16], [0.03, 0.03, 0.18], { outline: 0.006 });
    } else {
      // a chopping board and a jar
      k.box(m("#d0a46e", "wood"), [-0.12, 0.92, z + 0.04], [0.36, 0.02, 0.24], { rot: [0, 0.15, 0], outline: 0.006 });
      k.add("cyl", m("#e8dcc4"), [0.28, 0.98, z - 0.14], [0.1, 0.16, 0.1], { outline: 0.006 });
    }
  },

  stove: (k, w, d, p, m) => {
    const body = m(str(p, "body", "#ece6da"));
    const D = 0.64;
    const z = -d / 2 + D / 2;
    const W = Math.min(w, 0.78);
    k.box(body, [0, 0.46, z], [W, 0.86, D]);
    k.box(m(INK_DARK), [0, 0.42, z + D / 2 + 0.005], [W - 0.16, 0.42, 0.01], { outline: 0.006 });
    k.box(m("#56646b"), [0, 0.44, z + D / 2 + 0.012], [W - 0.3, 0.2, 0.006], { outline: false });
    k.box(m(METAL), [0, 0.68, z + D / 2 + 0.03], [W - 0.2, 0.025, 0.025], { outline: 0.005 });
    k.box(m("#d8d2c4"), [0, 0.9, z], [W, 0.02, D]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        k.add("cyl", m("#3a3631"), [sx * 0.18, 0.915, z + sz * 0.15], [0.2, 0.012, 0.2], { outline: false });
        k.add("torus", m("#6a645a"), [sx * 0.18, 0.925, z + sz * 0.15], [0.14, 0.14, 0.14], { rot: [Math.PI / 2, 0, 0], outline: false });
      }
    }
    k.box(body, [0, 1.0, z - D / 2 + 0.03], [W, 0.2, 0.06]);
    for (let i = 0; i < 4; i++) k.add("cyl", m(INK_DARK), [-0.24 + i * 0.16, 1.0, z - D / 2 + 0.07], [0.05, 0.03, 0.05], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    // a pot on the back burner
    k.add("cyl", m("#a6564a"), [0.18, 1.0, z - 0.15], [0.22, 0.16, 0.22]);
    k.add("cyl", m("#8f4a3f"), [0.18, 1.085, z - 0.15], [0.23, 0.015, 0.23], { outline: 0.005 });
  },

  fridge: (k, w, d, p, m) => {
    const body = m(str(p, "body", "#dfe7e4"));
    const D = 0.68;
    const z = -d / 2 + D / 2;
    const W = Math.min(w, 0.8);
    k.add("soft", body, [0, 0.93, z], [W, 1.86, D]);
    k.box(m(shade(str(p, "body", "#dfe7e4"), 0.82)), [0, 1.3, z + D / 2], [W - 0.02, 0.012, 0.012], { outline: false });
    const steel = m(METAL);
    k.box(steel, [-W / 2 + 0.1, 1.55, z + D / 2 + 0.03], [0.025, 0.3, 0.03], { outline: 0.005 });
    k.box(steel, [-W / 2 + 0.1, 0.95, z + D / 2 + 0.03], [0.025, 0.42, 0.03], { outline: 0.005 });
    // magnets and a note
    k.box(m("#fbf7ec"), [0.12, 1.05, z + D / 2 + 0.006], [0.16, 0.2, 0.004], { rot: [0, 0, 0.08], outline: 0.004 });
    k.add("sphere", m("#e07a5f"), [0.12, 1.14, z + D / 2 + 0.012], 0.03, { outline: false });
    k.add("sphere", m("#3d8fa3"), [0.2, 1.48, z + D / 2 + 0.012], 0.035, { outline: false });
  },

  toilet: (k, _w, d, _p, m) => {
    const china = m(PORCELAIN);
    const z = -d / 2 + 0.36;
    k.add("cone", china, [0, 0.2, z + 0.1], [0.3, 0.4, 0.36], { rot: [Math.PI, 0, 0] });
    k.add("soft", china, [0, 0.4, z + 0.13], [0.38, 0.08, 0.48]);
    k.add("torus", m("#e9e4d8"), [0, 0.45, z + 0.15], [0.32, 0.42, 0.32], { rot: [Math.PI / 2, 0, 0], outline: 0.005 });
    k.add("soft", china, [0, 0.62, z - 0.22], [0.42, 0.42, 0.18]);
    k.box(china, [0, 0.85, z - 0.22], [0.44, 0.04, 0.2]);
    k.box(m(METAL), [-0.14, 0.78, z - 0.12], [0.06, 0.02, 0.03], { outline: 0.004 });
  },

  bathtub: (k, w, d, p, m) => {
    const body = m(str(p, "body", "#f1ece2"));
    const W = w - 0.2;
    const D = d - 0.2;
    k.add("soft", body, [0, 0.42, 0], [W, 0.5, D]);
    k.add("soft", m("#e6e0d3"), [0, 0.67, 0], [W + 0.04, 0.06, D + 0.04]);
    k.box(m("#bcd3dc"), [0, 0.62, 0], [W - 0.14, 0.03, D - 0.14], { outline: false });
    const feet = m(str(p, "feet", "#b8955c"));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add("sphere", feet, [sx * (W / 2 - 0.12), 0.08, sz * (D / 2 - 0.1)], [0.1, 0.16, 0.1]);
    k.add("cyl", m(METAL), [-W / 2 + 0.05, 0.8, 0], [0.04, 0.24, 0.04], { outline: 0.005 });
    k.box(m(METAL), [-W / 2 + 0.13, 0.9, 0], [0.18, 0.03, 0.03], { outline: 0.005 });
    // a rubber duck
    k.add("sphere", m("#f2cf4a"), [0.25, 0.68, 0.1], [0.09, 0.08, 0.11], { outline: 0.005 });
    k.add("sphere", m("#f2cf4a"), [0.25, 0.75, 0.15], 0.06, { outline: 0.005 });
  },

  pedsink: (k, _w, d, _p, m) => {
    const china = m(PORCELAIN);
    const z = -d / 2 + 0.3;
    k.add("cone", china, [0, 0.38, z], [0.16, 0.76, 0.16], { rot: [Math.PI, 0, 0] });
    k.add("soft", china, [0, 0.82, z], [0.56, 0.16, 0.44]);
    k.box(m("#c9d6da"), [0, 0.905, z + 0.02], [0.4, 0.008, 0.28], { outline: false });
    k.add("cyl", m(METAL), [0, 0.98, z - 0.17], [0.035, 0.16, 0.035], { outline: 0.005 });
    k.box(m(METAL), [0, 1.05, z - 0.11], [0.025, 0.025, 0.12], { outline: 0.005 });
  },

  car: (k, _w, _d, p, m) => {
    const paint = str(p, "body", "#e07a5f");
    const body = m(paint);
    const dark = m("#3a3631");
    const glass = m("#a9c4cf");
    const chrome = m(METAL);
    // wheels with hub caps, turned to roll along z
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        k.add("cyl", dark, [sx * 0.7, 0.3, sz * 1.15], [0.6, 0.22, 0.6], { rot: [0, 0, Math.PI / 2] });
        k.add("cyl", chrome, [sx * 0.82, 0.3, sz * 1.15], [0.3, 0.02, 0.3], { rot: [0, 0, Math.PI / 2], outline: 0.005 });
      }
    k.add("soft", body, [0, 0.62, 0], [1.62, 0.56, 3.5]);
    // wheel arches
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add("half", m(shade(paint, 0.85)), [sx * 0.76, 0.6, sz * 1.15], [0.12, 0.34, 0.78], { rot: [0, 0, sx * -Math.PI / 2], outline: 0.006 });
    // cabin: glass band under a painted roof, a little behind centre
    k.add("soft", glass, [0, 1.1, -0.25], [1.42, 0.46, 1.9], { outline: 0.016 });
    k.add("soft", body, [0, 1.36, -0.3], [1.46, 0.1, 1.7]);
    for (const sx of [-1, 1]) k.box(body, [sx * 0.71, 1.1, -0.25], [0.04, 0.46, 0.08], { outline: 0.006 });
    // lights, bumpers, grille, mirrors, door seams and handles
    for (const sx of [-1, 1]) {
      k.add("sphere", m("#fff3c4"), [sx * 0.55, 0.72, 1.74], [0.26, 0.16, 0.06], { outline: 0.006 });
      k.box(m("#d0533f"), [sx * 0.6, 0.76, -1.75], [0.26, 0.12, 0.04], { outline: 0.006 });
      k.box(body, [sx * 0.8, 1.02, 0.55], [0.12, 0.08, 0.1], { outline: 0.006 });
      k.box(m(shade(paint, 0.8)), [sx * 0.815, 0.68, -0.25], [0.01, 0.42, 0.012], { outline: false });
      k.box(chrome, [sx * 0.82, 0.8, -0.05], [0.02, 0.03, 0.14], { outline: 0.004 });
    }
    k.box(m("#cfcac0"), [0, 0.42, 1.78], [1.56, 0.14, 0.1], { outline: 0.008 });
    k.box(m("#cfcac0"), [0, 0.42, -1.78], [1.56, 0.14, 0.1], { outline: 0.008 });
    k.box(dark, [0, 0.6, 1.76], [0.6, 0.14, 0.03], { outline: 0.005 });
    k.box(m("#f4efe4"), [0, 0.42, 1.84], [0.4, 0.1, 0.01], { outline: 0.004 });
  },

  workbench: (k, w, d, p, m, seed) => {
    const wood = str(p, "wood", "#b98a5a");
    const top = m(wood, "wood");
    const frame = m(shade(wood, 0.82), "wood");
    const W = w - 0.2;
    const z = -d / 2 + 0.38;
    legs(k, frame, W, 0.62, 0.88, 0.04, 0.06, "box");
    k.box(top, [0, 0.9, z], [W, 0.07, 0.66]);
    k.box(frame, [0, 0.22, z], [W - 0.12, 0.04, 0.56]);
    // a pegboard with tools hanging on it
    const peg = m("#d8c39d");
    k.box(peg, [0, 1.45, -d / 2 + 0.04], [W, 0.9, 0.03]);
    for (let x = -W / 2 + 0.1; x < W / 2; x += 0.12) for (let y = 1.08; y < 1.88; y += 0.12) k.box(m("#9b8662"), [x, y, -d / 2 + 0.056], [0.015, 0.015, 0.005], { outline: false });
    const metal = m(METAL);
    const handle = m("#c4534a");
    k.box(handle, [-0.6, 1.5, -d / 2 + 0.08], [0.05, 0.28, 0.04], { outline: 0.005 });
    k.box(metal, [-0.6, 1.66, -d / 2 + 0.08], [0.16, 0.05, 0.05], { outline: 0.005 });
    k.box(metal, [-0.25, 1.48, -d / 2 + 0.07], [0.3, 0.16, 0.01], { outline: 0.005 });
    k.box(handle, [-0.07, 1.48, -d / 2 + 0.08], [0.08, 0.12, 0.03], { outline: 0.005 });
    for (let i = 0; i < 4; i++) k.add("cyl8", m(i % 2 ? "#3d8fa3" : "#f2cf4a"), [0.15 + i * 0.08, 1.5, -d / 2 + 0.08], [0.025, 0.24, 0.025], { outline: 0.004 });
    // a vice, a toolbox and some offcuts on the bench
    k.box(m("#5d7f8f"), [W / 2 - 0.15, 0.99, z + 0.24], [0.14, 0.1, 0.16], { outline: 0.006 });
    k.box(m("#c4534a"), [-0.3, 1.0, z + 0.05], [0.42, 0.14, 0.2], { outline: 0.008 });
    k.box(metal, [-0.3, 1.1, z + 0.05], [0.24, 0.02, 0.03], { outline: 0.004 });
    const r = rng(seed);
    for (let i = 0; i < 3; i++) k.box(m(shade(wood, 1 + r() * 0.15), "wood"), [0.2 + r() * 0.3, 0.95 + i * 0.03, z + 0.1 - r() * 0.15], [0.3 + r() * 0.2, 0.03, 0.08], { rot: [0, r() * 0.5, 0], outline: 0.005 });
  },

  pool: (k, w, d, p, m) => {
    const coping = m(str(p, "coping", "#e4ddcf"), "stone");
    const c = 0.32;
    k.box(coping, [0, 0.07, -d / 2 + c / 2], [w, 0.1, c]);
    k.box(coping, [0, 0.07, d / 2 - c / 2], [w, 0.1, c]);
    k.box(coping, [-w / 2 + c / 2, 0.07, 0], [c, 0.1, d - c * 2]);
    k.box(coping, [w / 2 - c / 2, 0.07, 0], [c, 0.1, d - c * 2]);
    const water = str(p, "water", "#8fc3d1");
    k.box(m(shade(water, 0.82)), [0, 0.02, 0], [w - c * 2, 0.02, d - c * 2], { outline: false });
    k.box(m(water, "water"), [0, 0.06, 0], [w - c * 2, 0.01, d - c * 2], { outline: false });
    // steps at one end, seen through the water
    for (let i = 0; i < 3; i++) k.box(m(shade(water, 1.12 - i * 0.04)), [-w / 2 + c + 0.2 + i * 0.4, 0.067, 0], [0.4, 0.004, d - c * 2 - 0.1], { outline: false });
    // a ladder at the other end
    const metal = m(METAL);
    for (const s of [-1, 1]) {
      k.add("cyl8", metal, [w / 2 - c - 0.05, 0.4, s * 0.22], [0.04, 0.7, 0.04], { outline: 0.005 });
      k.add("torus", metal, [w / 2 - c - 0.2, 0.75, s * 0.22], [0.3, 0.3, 0.3], { rot: [0, 0, 0], outline: 0.004 });
    }
    // a float ring bobbing about
    k.add("torus", m("#e07a5f"), [0.6, 0.09, 0.3], [0.9, 0.9, 2.6], { rot: [Math.PI / 2, 0, 0], outline: 0.008 });
  },

  lounger: (k, w, d, p, m) => {
    const frame = m(str(p, "frame", "#f4efe4"));
    const cushion = str(p, "cushion", "#3d8fa3");
    const W = w - 0.36;
    legs(k, frame, W, d - 0.3, 0.26, 0.025, 0.04, "box");
    k.box(frame, [0, 0.27, 0.2], [W, 0.05, d - 0.7]);
    k.add("soft", m(cushion, "fabric"), [0, 0.33, 0.22], [W - 0.04, 0.07, d - 0.78]);
    // backrest tilted up at the head end
    k.at([0, 0.3, -d / 2 + 0.55], 0, () => {
      k.box(frame, [0, 0.22, -0.18], [W, 0.04, 0.56], { rot: [0.95, 0, 0] });
      k.add("soft", m(cushion, "fabric"), [0, 0.26, -0.14], [W - 0.04, 0.07, 0.52], { rot: [0.95, 0, 0] });
    });
    // a rolled towel
    k.add("cyl", m("#f2cf4a", "fabric"), [0, 0.42, d / 2 - 0.6], [0.14, W - 0.1, 0.14], { rot: [0, 0, Math.PI / 2], outline: 0.006 });
  },

  parasol: (k, _w, _d, p, m) => {
    const canopy = str(p, "canopy", "#f2cf4a");
    k.add("cyl", m("#e4ddcf", "stone"), [0, 0.05, 0], [0.5, 0.1, 0.5]);
    k.add("cyl8", m("#8a6a4c", "wood"), [0, 1.15, 0], [0.05, 2.2, 0.05]);
    k.add(CANOPY, m(canopy, "fabric"), [0, 2.08, 0], [2.0, 0.5, 2.0], { outline: 0.014, normals: true });
    k.add("cyl8", m(shade(canopy, 0.8)), [0, 1.84, 0], [1.98, 0.06, 1.98], { outline: 0.008 });
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      k.add("sphere", m("#f4efe4"), [Math.sin(a) * 0.93, 1.78, Math.cos(a) * 0.93], 0.06, { outline: 0.004 });
    }
    k.add("sphere", m("#8a6a4c"), [0, 2.36, 0], 0.08, { outline: 0.005 });
  },

  shrub: (k, _w, _d, p, m, seed) => {
    const leaves = str(p, "leaves", "#88a873");
    const r = rng(seed);
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2;
      const rad = r() * 0.2;
      const s = 0.42 + r() * 0.2;
      k.add("blob", m(shade(leaves, 0.82 + r() * 0.3)), [Math.cos(a) * rad, 0.28 + r() * 0.25, Math.sin(a) * rad], [s, s * 0.85, s], { outline: 0.012 });
    }
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      k.add("sphere", m(i % 2 ? "#f4efe4" : "#ecc9bd"), [Math.cos(a) * 0.32, 0.42 + r() * 0.3, Math.sin(a) * 0.32], 0.06, { outline: 0.004 });
    }
  },
};

const fallback: Builder = (k, w, d, _p, m) => k.box(m("#c8b89a"), [0, 0.4, 0], [w - 0.2, 0.8, d - 0.2]);

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const built = new Map<string, BuiltMesh[]>();

/** The merged meshes for a catalog item (shared by every copy of it), optionally as a see-through ghost. */
export function modelFor(item: FurnitureItem, ghost: "ok" | "bad" | null = null): BuiltMesh[] {
  const key = `${item.id}|${ghost ?? ""}`;
  let out = built.get(key);
  if (!out) {
    const k = new Kit();
    const m: Mat = (tone, finish, alpha) => pencilMaterial(tone, { finish, alpha, ghost: ghost ?? undefined });
    const build = BUILDERS[item.model.kind] ?? fallback;
    build(k, item.footprint[0], item.footprint[1], item.model as Params, m, hashString(item.id));
    out = k.build(Boolean(ghost));
    built.set(key, out);
  }
  return out;
}

/**
 * Doors and windows. Built centred on the opening, standing on the floor, with x along the wall and +z towards the
 * opening's front (outside): doors swing in towards -z, window sills and flower boxes stick out towards +z.
 * `low` draws what's left when walls are cut away or down: a threshold for doors, a sill line for windows.
 */
type OpeningBuilder = (k: Kit, item: OpeningItem, p: Params, m: Mat, low: number | null) => void;

/** Wall thickness, matching the walls they sit in. */
const T = 0.14;

/** Architrave trim around an opening on both faces of the wall. */
function trims(k: Kit, mat: THREE.Material, W: number, y0: number, y1: number, bottom: boolean) {
  for (const s of [-1, 1]) {
    const z = s * (T / 2 + 0.012);
    for (const sx of [-1, 1]) k.box(mat, [sx * (W / 2 + 0.035), (y0 + y1) / 2, z], [0.07, y1 - y0, 0.024], { outline: 0.006 });
    k.box(mat, [0, y1 + 0.04, z], [W + 0.14, 0.08, 0.024], { outline: 0.006 });
    if (bottom) k.box(mat, [0, y0 - 0.03, z], [W + 0.1, 0.06, 0.024], { outline: 0.006 });
  }
}

/** One door leaf, hinged at its left edge (x = 0), swung in by `open` radians. */
function leaf(k: Kit, m: Mat, hingeX: number, width: number, height: number, open: number, color: string, glass: boolean, mirror: boolean) {
  const sign = mirror ? -1 : 1;
  k.at([hingeX, 0, 0], sign * open, () => {
    const cx = sign * (width / 2);
    const wood = m(color, "wood");
    const panel = m(shade(color, 1.07), "wood");
    k.box(wood, [cx, height / 2 + 0.01, 0], [width, height, 0.045], { outline: 0.01 });
    for (const s of [-1, 1]) {
      const z = s * 0.026;
      if (glass) {
        k.box(m("#cfe2ea", undefined, 0.5), [cx, height * 0.68, 0], [width - 0.16, height * 0.5, 0.05], { outline: false });
        k.box(wood, [cx, height * 0.68, z], [0.03, height * 0.5, 0.008], { outline: 0.004 });
        k.box(wood, [cx, height * 0.68, z], [width - 0.16, 0.03, 0.008], { outline: 0.004 });
        k.box(panel, [cx, height * 0.22, z], [width - 0.2, height * 0.26, 0.01], { outline: 0.005 });
      } else {
        k.box(panel, [cx, height * 0.7, z], [width - 0.22, height * 0.38, 0.01], { outline: 0.005 });
        k.box(panel, [cx, height * 0.26, z], [width - 0.22, height * 0.34, 0.01], { outline: 0.005 });
      }
      k.add("sphere", m(METAL), [sign * (width - 0.08), 0.98, s * 0.05], 0.045, { outline: 0.005 });
    }
  });
}

const OPENING_BUILDERS: Record<string, OpeningBuilder> = {
  door: (k, item, p, m, low) => {
    const W = item.width;
    const frame = m(str(p, "frame", "#f4efe4"));
    k.box(m("#cfc6b6", "stone"), [0, 0.012, 0], [W, 0.024, T + 0.04], { outline: 0.005 });
    if (low !== null) {
      for (const sx of [-1, 1]) k.box(frame, [sx * (W / 2 - 0.03), low / 2, 0], [0.06, low, T + 0.03], { outline: 0.006 });
      return;
    }
    const top = item.top;
    for (const sx of [-1, 1]) k.box(frame, [sx * (W / 2 - 0.03), top / 2, 0], [0.06, top, T + 0.03], { outline: 0.008 });
    k.box(frame, [0, top - 0.03, 0], [W, 0.06, T + 0.03], { outline: 0.008 });
    trims(k, frame, W, 0, top, false);
    const color = str(p, "leaf", "#a57a50");
    const glass = p.glass === true;
    const inner = W - 0.12;
    const h = top - 0.08;
    // the door stands a little ajar, swung in towards -z
    k.at([0, 0, -0.03], 0, () => {
      if (p.double === true) {
        leaf(k, m, -inner / 2, inner / 2, h, 0.45, color, glass, false);
        leaf(k, m, inner / 2, inner / 2, h, 0.45, color, glass, true);
      } else leaf(k, m, -inner / 2, inner, h, 0.4, color, glass, false);
    });
  },

  arch: (k, item, p, m, low) => {
    const W = item.width;
    const frame = m(str(p, "frame", "#f4efe4"));
    if (low !== null) {
      for (const sx of [-1, 1]) k.box(frame, [sx * (W / 2 - 0.03), low / 2, 0], [0.06, low, T + 0.03], { outline: 0.006 });
      return;
    }
    const top = item.top;
    for (const sx of [-1, 1]) {
      k.box(frame, [sx * (W / 2 - 0.04), top / 2, 0], [0.08, top, T + 0.05], { outline: 0.01 });
      // rounded shoulders where the jambs meet the head
      k.add("cyl", frame, [sx * (W / 2 - 0.16), top - 0.12, 0], [0.24, T + 0.04, 0.24], { rot: [Math.PI / 2, 0, 0], outline: 0.006 });
    }
    k.box(frame, [0, top - 0.04, 0], [W, 0.08, T + 0.05], { outline: 0.01 });
    k.box(m(shade(str(p, "frame", "#f4efe4"), 0.92)), [0, top + 0.02, 0], [0.16, 0.14, T + 0.07], { outline: 0.006 });
  },

  garage: (k, item, p, m, low) => {
    const W = item.width;
    const panel = str(p, "panel", "#efe9dc");
    const frame = m(shade(panel, 0.9));
    if (low !== null) {
      k.box(frame, [0, 0.012, 0], [W, 0.024, T + 0.04], { outline: 0.005 });
      for (const sx of [-1, 1]) k.box(frame, [sx * (W / 2 - 0.04), low / 2, 0], [0.08, low, T + 0.03], { outline: 0.006 });
      return;
    }
    const top = item.top;
    for (const sx of [-1, 1]) k.box(frame, [sx * (W / 2 - 0.04), top / 2, 0], [0.08, top, T + 0.03], { outline: 0.008 });
    k.box(frame, [0, top - 0.05, 0], [W, 0.1, T + 0.03], { outline: 0.008 });
    const inner = W - 0.16;
    const h = top - 0.1;
    k.box(m(panel), [0, h / 2, 0.03], [inner, h, 0.05], { outline: 0.01 });
    // four sections with grooves, a row of little windows in the top one, a handle
    for (let i = 1; i < 4; i++) for (const s of [-1, 1]) k.box(m(shade(panel, 0.84)), [0, (h / 4) * i, 0.03 + s * 0.027], [inner, 0.025, 0.006], { outline: false });
    for (let i = 0; i < 4; i++) {
      const x = -inner / 2 + inner / 8 + (inner / 4) * i;
      k.box(m("#a9c4cf"), [x, h * 0.86, 0.058], [inner / 4 - 0.2, 0.22, 0.01], { outline: 0.005 });
      for (const sx of [-1, 1]) k.box(m(shade(panel, 0.9)), [x + sx * 0.5 * (inner / 4 - 0.2), h * 0.6, 0.058], [0.02, h * 0.3, 0.006], { outline: false });
    }
    k.box(m(METAL), [0, 0.42, 0.065], [0.3, 0.04, 0.03], { outline: 0.004 });
    trims(k, frame, W, 0, top, false);
  },

  window: (k, item, p, m, low) => {
    const W = item.width;
    const frameColor = str(p, "frame", "#f4efe4");
    const frame = m(frameColor);
    if (low !== null) {
      // a pale line on top of the low wall shows where the window is
      k.box(m("#bfd9e3"), [0, low + 0.012, 0], [W - 0.06, 0.02, T + 0.02], { outline: 0.005 });
      return;
    }
    const sill = item.sill;
    const top = item.top;
    const h = top - sill;
    for (const sx of [-1, 1]) k.box(frame, [sx * (W / 2 - 0.035), sill + h / 2, 0], [0.07, h, T + 0.02], { outline: 0.008 });
    k.box(frame, [0, top - 0.035, 0], [W, 0.07, T + 0.02], { outline: 0.008 });
    k.box(frame, [0, sill + 0.035, 0], [W, 0.07, T + 0.02], { outline: 0.008 });
    // a sill ledge that sticks out on both sides, more on the outside
    k.box(m(shade(frameColor, 0.95)), [0, sill - 0.02, 0.04], [W + 0.16, 0.045, T + 0.18], { outline: 0.008 });
    k.box(m("#cfe2ea", undefined, 0.38), [0, sill + h / 2, 0], [W - 0.1, h - 0.1, 0.02], { outline: false });
    const panes = Math.max(1, Math.round(num(p, "panes", 2)));
    for (let i = 1; i < panes; i++) k.box(frame, [-W / 2 + 0.05 + ((W - 0.1) / panes) * i, sill + h / 2, 0], [0.035, h - 0.1, 0.05], { outline: 0.005 });
    k.box(frame, [0, sill + h * 0.62, 0], [W - 0.1, 0.035, 0.05], { outline: 0.005 });
    trims(k, frame, W, sill, top, false);
    // curtains tied back inside
    const curtain = m(str(p, "curtain", "#efe0c8"), "fabric");
    for (const sx of [-1, 1]) k.add("soft", curtain, [sx * (W / 2 + 0.02), sill + h / 2 + 0.06, -T / 2 - 0.07], [0.2, h + 0.12, 0.07]);
    k.box(m("#8a6a4c", "wood"), [0, top + 0.16, -T / 2 - 0.07], [W + 0.5, 0.035, 0.035], { outline: 0.004 });
    if (p.box === true) {
      // a flower box under the outside sill
      k.box(m("#a57a50", "wood"), [0, sill - 0.14, T / 2 + 0.14], [W - 0.1, 0.18, 0.2], { outline: 0.008 });
      const r = rng(item.width * 97 + Math.round(sill * 100));
      for (let i = 0; i < W * 6; i++) {
        const x = -W / 2 + 0.12 + r() * (W - 0.24);
        k.add("blob", m(shade("#7fa36a", 0.85 + r() * 0.3)), [x, sill - 0.02 + r() * 0.05, T / 2 + 0.14 + (r() - 0.5) * 0.1], 0.1 + r() * 0.05, { outline: 0.006 });
        if (i % 2) k.add("sphere", m(["#e07a5f", "#f2cf4a", "#ecc9bd"][i % 3]!), [x, sill + 0.06 + r() * 0.05, T / 2 + 0.16], 0.05, { outline: 0.004 });
      }
    }
  },
};

const builtOpenings = new Map<string, BuiltMesh[]>();

/** The merged meshes for a door or window; `low` is the cut-down wall height to draw instead of the full one. */
export function openingModelFor(item: OpeningItem, ghost: "ok" | "bad" | null = null, low: number | null = null): BuiltMesh[] {
  const key = `${item.id}|${ghost ?? ""}|${low ?? ""}`;
  let out = builtOpenings.get(key);
  if (!out) {
    const k = new Kit();
    const m: Mat = (tone, finish, alpha) => pencilMaterial(tone, { finish, alpha, ghost: ghost ?? undefined });
    (OPENING_BUILDERS[item.model.kind] ?? OPENING_BUILDERS.door!)(k, item, item.model as Params, m, low);
    out = k.parts.length ? k.build(Boolean(ghost)) : [];
    builtOpenings.set(key, out);
  }
  return out;
}
