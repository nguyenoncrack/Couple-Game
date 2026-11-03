import type { FurnitureItem } from "@cg/shared";
import type * as THREE from "three";
import { Kit, type BuiltMesh } from "./kit";
import { pencilMaterial, type Finish } from "./pencil";

/**
 * Furniture models, drawn from each catalog item's `model` description. A builder gets the item's footprint in
 * metres (width along x, depth along z), its model params, and a material maker, and builds the piece centred on
 * the origin, standing on y = 0 and facing +z. New catalog items reuse these by kind with their own colours.
 */

type Mat = (tone: string, finish?: Finish) => THREE.Material;
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
    legs(k, m(shade(wood, 0.7)), W, D, 0.1, 0.02, 0.06);
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
    legs(k, m(shade(wood, 0.8)), 0.48, 0.42, 0.08, 0.02, 0.04);
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
    const m: Mat = (tone, finish) => pencilMaterial(tone, { finish, ghost: ghost ?? undefined });
    const build = BUILDERS[item.model.kind] ?? fallback;
    build(k, item.footprint[0], item.footprint[1], item.model as Params, m, hashString(item.id));
    out = k.build(Boolean(ghost));
    built.set(key, out);
  }
  return out;
}
