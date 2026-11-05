import * as THREE from "three";
import type { Kit } from "../../render/kit";
import { natureMaterial } from "../../render/nature";
import type { Run, Gap } from "../../render/House";
const WALL_T = 0.14;

export function buildWall(k: Kit, run: Run, height: number, mat: THREE.Material, trim: THREE.Material, gaps: Gap[] = []) {
  const place = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
    const mid = (a + b) / 2;
    const [x, z] = run.dir === "h" ? [mid, run.at] : [run.at, mid];
    const size = (l: number, h: number, t: number): [number, number, number] => (run.dir === "h" ? [l, h, t] : [t, h, l]);
    const len = b - a;
    if (mat.userData.buildGlass) {
      glassSection(k, run, a, b, y0, y1, mat);
      return;
    }
    k.box(mat, [x, (y0 + y1) / 2, z], size(len, y1 - y0, WALL_T), { outline: 0.024 });
    if (y0 === 0) k.box(trim, [x, 0.06, z], size(len + 0.02, 0.12, WALL_T + 0.035), { outline: 0.008 });
    if (y1 === height) k.box(trim, [x, height + 0.015, z], size(len + 0.02, 0.03, WALL_T + 0.03), { outline: 0.008 });
  };
  // Solid wall between the gaps; the ends reach half a wall's thickness further so corners close.
  const sorted = gaps.map((g) => ({ ...g, from: Math.max(g.from, run.from), to: Math.min(g.to, run.to) })).sort((a, b) => a.from - b.from);
  let cursor = run.from - WALL_T / 2;
  for (const g of sorted) {
    place(cursor, g.from === run.from ? g.from - WALL_T / 2 : g.from, 0, height);
    if (g.sill > 0) place(g.from, g.to, 0, Math.min(g.sill, height));
    if (g.top < height) place(g.from, g.to, g.top, height);
    cursor = g.to === run.to ? g.to + WALL_T / 2 : g.to;
  }
  place(cursor, run.to + WALL_T / 2, 0, height);
}


/** Rails and mullions are clipped to the same door/window gaps as opaque walls. */
function glassSection(k: Kit, run: Run, a: number, b: number, bottom: number, top: number, glass: THREE.Material) {
  const frame = natureMaterial("#44525a", { finish: "metal" });
  const width = 0.055;
  const box = (mat: THREE.Material, x: number, y: number, span: number, h: number, t: number) =>
    k.box(mat, run.dir === "h" ? [x, y, run.at] : [run.at, y, x], run.dir === "h" ? [span, h, t] : [t, h, span], { outline: false });
  if (b - a > width * 2 && top - bottom > width * 2) box(glass, (a + b) / 2, (bottom + top) / 2, b - a - width, top - bottom - width, 0.026);
  box(frame, (a + b) / 2, bottom + width / 2, b - a, width, WALL_T);
  box(frame, (a + b) / 2, top - width / 2, b - a, width, WALL_T);
  for (const x of [a + width / 2, ...Array.from({ length: Math.max(0, Math.ceil(b) - Math.floor(a) - 1) }, (_, i) => Math.floor(a) + i + 1).filter((x) => x > a + width && x < b - width), b - width / 2])
    box(frame, x, (bottom + top) / 2, width, top - bottom, WALL_T);
}
