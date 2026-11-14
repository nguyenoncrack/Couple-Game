import * as THREE from "three";
import type { Kit } from "../kit";
import type { Finish } from "../pencil";

/**
 * The cozy pieces for rainy days: a window bench for two, a reading lamp, a blanket basket, an umbrella stand, a tea
 * set for two and a patterned rug. Built like the rest of the furniture: centred on the origin, standing on y = 0, facing
 * +z, inside the footprint (w across x, d across z). The lamp's shade glows after dark (see lamps.ts).
 */

type Mat = (tone: string, finish?: Finish, alpha?: number, glow?: number) => THREE.Material;
type Params = Record<string, unknown>;
type Builder = (k: Kit, w: number, d: number, p: Params, m: Mat, seed: number) => void;

const str = (p: Params, key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** The height of the bench's seat (metres): where its sitters rest (the catalog's slot `y` matches). */
export const BENCH_SEAT = 0.46;

export const COZY_BUILDERS: Record<string, Builder> = {
  // A two-seat window bench: a storage base with drawer fronts, a long cushion and a bolster at each end. No back, so
  // two people can sit shoulder to shoulder facing the window behind it (the sitters face -z).
  windowbench: (k, w, d, p, m) => {
    const wood = str(p, "wood", "#b98a5a");
    const cushion = str(p, "cushion", "#8fa6b0");
    const W = w - 0.12;
    const D = d - 0.16;
    const frame = m(wood, "timber");
    k.box(m(shade(wood, 0.78), "timber"), [0, 0.04, 0], [W - 0.08, 0.08, D - 0.08]);
    k.box(frame, [0, 0.23, 0], [W, 0.3, D]);
    // two drawer fronts on the room side, each with a small pull
    for (const s of [-1, 1]) {
      k.box(m(shade(wood, 1.1), "timber"), [s * (W / 4), 0.23, D / 2 + 0.004], [W / 2 - 0.1, 0.22, 0.012], { outline: 0.004 });
      k.add("sphere", m("#c9a35c", "metal"), [s * (W / 4), 0.27, D / 2 + 0.03], 0.04, { outline: false });
    }
    // the seat: one long cushion, a seam down the middle
    k.add("soft", m(cushion, "fabric"), [0, 0.4, 0], [W - 0.04, 0.13, D - 0.02]);
    k.box(m(shade(cushion, 0.8), "fabric"), [0, 0.465, 0], [0.012, 0.01, D - 0.14], { outline: false });
    // bolsters at the ends, and a folded throw over one
    const pillow = str(p, "pillow", "#e9d6b6");
    for (const s of [-1, 1]) k.add("soft", m(pillow, "fabric"), [s * (W / 2 - 0.15), 0.58, -D / 4], [0.24, 0.24, 0.34], { rot: [0.1, 0, s * 0.12] });
    k.add("soft", m(shade(cushion, 1.2), "fabric"), [-W / 2 + 0.42, 0.5, D / 6], [0.42, 0.04, 0.36], { rot: [0, 0.25, 0], outline: 0.006 });
  },

  // A reading lamp: a weighted round base, a slim stem and an arm that reaches over, a warm drum shade that glows at night.
  readinglamp: (k, _w, _d, p, m) => {
    const metal = m(str(p, "metal", "#8a6a45"), "metal");
    k.add("cyl", m(str(p, "base", "#4b4038"), "metal"), [0, 0.02, 0], [0.34, 0.04, 0.34]);
    k.add("cyl8", metal, [0, 0.74, 0], [0.025, 1.4, 0.025]);
    k.add("sphere", metal, [0, 1.44, 0], 0.06, { outline: 0.004 });
    // the arm, swung out to one side with the shade hung from its end
    k.add("cyl8", metal, [0.13, 1.47, 0], [0.02, 0.28, 0.02], { rot: [0, 0, -1.25], outline: 0.004 });
    k.add("cone", m(str(p, "shade", "#f3e2b8"), "fabric", undefined, 0.85), [0.27, 1.38, 0], [0.3, 0.22, 0.3]);
    k.add("sphere", m("#fff6d8", undefined, undefined, 1), [0.27, 1.3, 0], 0.07, { outline: false });
  },

  // A round woven basket with a couple of blankets folded in and one trailing over the rim.
  blanketbasket: (k, _w, _d, p, m) => {
    const wicker = str(p, "wicker", "#c79a62");
    const weave = m(wicker, "timber");
    k.add("cyl", weave, [0, 0.2, 0], [0.66, 0.4, 0.66]);
    for (const y of [0.09, 0.2, 0.31]) k.add("torus", m(shade(wicker, 0.8), "timber"), [0, y, 0], [0.67, 0.67, 0.4], { rot: [Math.PI / 2, 0, 0], outline: false });
    k.add("torus", m(shade(wicker, 1.1), "timber"), [0, 0.4, 0], [0.66, 0.66, 0.66], { rot: [Math.PI / 2, 0, 0] });
    k.add("cyl", m(shade(wicker, 0.55), "fabric"), [0, 0.385, 0], [0.56, 0.02, 0.56], { outline: false });
    const blanket = str(p, "blanket", "#a9605a");
    k.add("soft", m(blanket, "fabric"), [-0.02, 0.5, 0], [0.5, 0.17, 0.44]);
    k.add("soft", m(str(p, "blanket2", "#e6d9bd"), "fabric"), [0.03, 0.62, 0.02], [0.42, 0.12, 0.38], { rot: [0, 0.4, 0.06] });
    // a corner trailing over the front edge
    k.add("soft", m(shade(blanket, 1.1), "fabric"), [0.1, 0.34, 0.31], [0.26, 0.3, 0.06], { rot: [-0.12, 0.3, 0] });
  },

  // A tall round ceramic stand with a brass rim, three umbrellas standing in it with their hooked handles up.
  umbrellastand: (k, _w, _d, p, m) => {
    const body = str(p, "body", "#4f6f7c");
    k.add("cyl", m(body, "ceramic"), [0, 0.32, 0], [0.34, 0.64, 0.34]);
    k.add("cyl", m(shade(body, 0.78), "ceramic"), [0, 0.03, 0], [0.38, 0.06, 0.38]);
    k.add("torus", m(str(p, "rim", "#c9a35c"), "metal"), [0, 0.64, 0], [0.34, 0.34, 0.34], { rot: [Math.PI / 2, 0, 0] });
    const umbrellas: [number, number, number, string][] = [
      [-0.05, 0.03, 0.1, str(p, "umbrella", "#d9684a")],
      [0.07, -0.03, -0.12, str(p, "umbrella2", "#2f4a63")],
      [0.0, 0.07, 0.02, "#efe0b6"],
    ];
    for (const [x, z, lean, color] of umbrellas) {
      // the furled canopy near the top, the shaft below it, a hooked handle on top
      k.add("cyl8", m("#3a3631", "metal"), [x, 0.6, z], [0.016, 0.9, 0.016], { rot: [lean * 0.4, 0, -lean], outline: 0.003 });
      k.add("cone", m(color, "fabric"), [x + lean * 0.25, 0.9, z], [0.1, 0.34, 0.1], { rot: [lean * 0.4, 0, -lean], outline: 0.004 });
      k.add("torus", m("#6b4c33", "timber"), [x - lean * 0.2, 1.1, z], [0.1, 0.1, 0.1], { rot: [0, Math.PI / 2, -lean], outline: 0.003 });
    }
  },

  // A low round table with a tea tray on it: a teapot, and two cups on saucers, one on each side.
  teaset: (k, _w, _d, p, m) => {
    const wood = str(p, "wood", "#a57a50");
    const china = m(str(p, "china", "#f4efe4"), "ceramic");
    const trim = m(str(p, "trim", "#5b8aa3"), "ceramic");
    const top = 0.42;
    k.add("cyl", m(wood, "timber"), [0, top - 0.02, 0], [0.8, 0.04, 0.8]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      k.add("cyl8", m(shade(wood, 0.82), "timber"), [Math.cos(a) * 0.26, (top - 0.04) / 2, Math.sin(a) * 0.26], [0.045, top - 0.04, 0.045]);
    }
    // the tray
    k.add("cyl", m("#6b5141", "timber"), [0, top + 0.012, 0], [0.56, 0.024, 0.56], { outline: 0.006 });
    // the teapot: a round body, a lid with a knob, a spout and a handle
    const potX = -0.02;
    const potZ = -0.08;
    k.add("sphere", china, [potX, top + 0.12, potZ], [0.26, 0.2, 0.26]);
    k.add("half", china, [potX, top + 0.2, potZ], [0.14, 0.06, 0.14], { outline: 0.004 });
    k.add("sphere", trim, [potX, top + 0.265, potZ], 0.035, { outline: 0.003 });
    k.add("cone", china, [potX + 0.17, top + 0.14, potZ], [0.05, 0.16, 0.05], { rot: [0, 0, -0.9], outline: 0.004 });
    k.add("torus", trim, [potX - 0.15, top + 0.13, potZ], [0.14, 0.14, 0.14], { rot: [0, Math.PI / 2, 0], outline: 0.004 });
    k.add("cyl", trim, [potX, top + 0.103, potZ], [0.262, 0.018, 0.262], { outline: false });
    // two cups with saucers
    for (const s of [-1, 1]) {
      const cx = s * 0.17;
      const cz = 0.14;
      k.add("cyl", china, [cx, top + 0.034, cz], [0.15, 0.01, 0.15], { outline: 0.004 });
      k.add("cyl", china, [cx, top + 0.075, cz], [0.09, 0.07, 0.09], { outline: 0.004 });
      k.add("cyl", m("#8a5a3a"), [cx, top + 0.108, cz], [0.076, 0.004, 0.076], { outline: false });
      k.add("torus", trim, [cx + s * 0.05, top + 0.075, cz], [0.06, 0.06, 0.06], { rot: [0, Math.PI / 2, 0], outline: 0.003 });
    }
  },

  // A woven rug with a repeating diamond pattern and a plain border, fringed at the short ends.
  patternrug: (k, w, d, p, m) => {
    const color = str(p, "color", "#e8dcc2");
    const pattern = str(p, "pattern", "#5f7f8f");
    const accent = str(p, "accent", "#c9785d");
    const border = str(p, "border", "#8a4f3f");
    const W = w - 0.15;
    const D = d - 0.15;
    k.box(m(border, "carpet"), [0, 0.008, 0], [W, 0.012, D], { outline: 0.006, normals: true });
    k.box(m(color, "carpet"), [0, 0.012, 0], [W - 0.18, 0.012, D - 0.18], { outline: false });
    // a thin line just inside the border
    k.box(m(pattern, "carpet"), [0, 0.0175, 0], [W - 0.3, 0.012, D - 0.3], { outline: false });
    k.box(m(color, "carpet"), [0, 0.0185, 0], [W - 0.34, 0.012, D - 0.34], { outline: false });
    // rows of diamonds, every other one picked out in the accent colour
    const cols = Math.max(3, Math.round((W - 0.6) / 0.34));
    const rows = Math.max(2, Math.round((D - 0.6) / 0.34));
    const stepX = (W - 0.6) / cols;
    const stepZ = (D - 0.6) / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = -((cols - 1) * stepX) / 2 + i * stepX;
        const z = -((rows - 1) * stepZ) / 2 + j * stepZ;
        const s = Math.min(stepX, stepZ) * 0.62;
        k.box(m(pattern, "carpet"), [x, 0.021, z], [s, 0.006, s], { rot: [0, Math.PI / 4, 0], outline: false });
        k.box(m((i + j) % 2 ? accent : color, "carpet"), [x, 0.0245, z], [s * 0.5, 0.006, s * 0.5], { rot: [0, Math.PI / 4, 0], outline: false });
      }
    for (const sx of [-1, 1]) for (let i = 0; i < Math.floor(D / 0.06); i++) k.box(m("#efe6d2"), [sx * (W / 2 + 0.03), 0.004, -D / 2 + 0.03 + i * 0.06], [0.06, 0.006, 0.015], { outline: false });
  },
};
