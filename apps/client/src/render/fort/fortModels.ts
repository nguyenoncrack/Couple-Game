import * as THREE from "three";
import type { Kit } from "../kit";
import type { Finish } from "../pencil";

/**
 * The blanket fort kit's models, drawn like the rest of the furniture (centred on the origin, standing on y = 0,
 * facing +z, inside the footprint). The frame's blanket is drawn live (see FortLive), because its pattern, its
 * glow and how see-through it is all follow the fort's settings; here it's only drawn for a placement preview and
 * for the catalog's picture (`inUse` leaves it out).
 */

type Mat = (tone: string, finish?: Finish, alpha?: number) => THREE.Material;
type Params = Record<string, unknown>;
type Builder = (k: Kit, w: number, d: number, p: Params, m: Mat, seed: number) => void;

const str = (p: Params, key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);

/** How high the ridge of the blanket is, and how wide a door the front has (metres). */
export const FORT_H = 1.4;
export const DOOR_W = 1;
/** Where the fairy lights hang, relative to the middle of the lights' own cell. */
export const BULB_Y = 1.2;

/**
 * The blanket over the ridge: two slopes, the closed ends, and a short header over the door at the front. Open
 * at the door and underneath, with UVs that run along the cloth so a pattern tiles evenly (about 0.7 m a tile).
 */
export function canopyGeometry(w = 3, d = 2): THREE.BufferGeometry {
  const hx = w / 2 - 0.05;
  const hz = d / 2 - 0.05;
  const lo = 0.04;
  const door = DOOR_W / 2;
  const head = 0.98;
  // where the front slope is when it's `y` high
  const zAt = (y: number) => hz * ((FORT_H - y) / (FORT_H - lo));
  const pos: number[] = [];
  const uv: number[] = [];
  const TILE = 0.7;
  /** A quad a, b, c, d (counter-clockwise from outside), with UVs from `u`/`v` coordinates in metres. */
  const quad = (a: number[], b: number[], c: number[], e: number[], uvs: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = [a, b, c, e][i]!;
      pos.push(p[0]!, p[1]!, p[2]!);
      const t = uvs[i]!;
      uv.push(t[0]! / TILE, t[1]! / TILE);
    }
  };
  const slope = Math.hypot(FORT_H - lo, hz);
  // back
  quad([-hx, lo, -hz], [-hx, FORT_H, 0], [hx, FORT_H, 0], [hx, lo, -hz], [[0, slope], [0, 0], [2 * hx, 0], [2 * hx, slope]]);
  // front, either side of the door
  quad([-hx, lo, hz], [-door, lo, hz], [-door, FORT_H, 0], [-hx, FORT_H, 0], [[0, slope], [hx - door, slope], [hx - door, 0], [0, 0]]);
  quad([door, lo, hz], [hx, lo, hz], [hx, FORT_H, 0], [door, FORT_H, 0], [[hx + door, slope], [2 * hx, slope], [2 * hx, 0], [hx + door, 0]]);
  // the header over the door
  const hzAt = zAt(head);
  quad([-door, head, hzAt], [door, head, hzAt], [door, FORT_H, 0], [-door, FORT_H, 0], [[hx - door, (FORT_H - head) * 1.3], [hx + door, (FORT_H - head) * 1.3], [hx + door, 0], [hx - door, 0]]);
  // the two closed ends
  for (const s of [-1, 1]) {
    const x = s * hx;
    const tri = (a: number[], b: number[], c: number[], uvs: number[][]) => {
      [a, b, c].forEach((p, i) => {
        pos.push(p[0]!, p[1]!, p[2]!);
        uv.push(uvs[i]![0]! / TILE, uvs[i]![1]! / TILE);
      });
    };
    if (s > 0) tri([x, lo, -hz], [x, FORT_H, 0], [x, lo, hz], [[0, 0], [hz, FORT_H], [2 * hz, 0]]);
    else tri([x, lo, -hz], [x, lo, hz], [x, FORT_H, 0], [[0, 0], [2 * hz, 0], [hz, FORT_H]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** The fairy lights' bulbs, in the lights' own cell (x along the string, y up, z across), spread along and sagging between three hooks. */
export function bulbPositions(w = 3): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = (t - 0.5) * (w - 0.3);
    const sag = Math.sin(t * Math.PI * 2) ** 2 * 0.09;
    out.push([x, BULB_Y - sag, 0.02 + Math.sin(t * Math.PI) * 0.08]);
  }
  return out;
}

export const FORT_BUILDERS: Record<string, Builder> = {
  // The fort: a ridge pole on two uprights, pegs at the corners, the door tied back, and (unless drawn live) the blanket.
  fortframe: (k, w, d, p, m, seed) => {
    const pole = m(str(p, "pole", "#b08a5e"), "timber");
    const rope = m("#e8d9b8", "fabric");
    for (const s of [-1, 1]) {
      k.add("cyl8", pole, [s * (w / 2 - 0.05), FORT_H / 2, 0], [0.05, FORT_H, 0.05], { outline: 0.006 });
      k.add("sphere", m("#d9a05b", "timber"), [s * (w / 2 - 0.05), FORT_H + 0.01, 0], 0.09, { outline: 0.005 });
    }
    k.add("cyl8", pole, [0, FORT_H, 0], [0.04, w - 0.05, 0.04], { rot: [0, 0, Math.PI / 2], outline: 0.006 });
    // pegs and guy ropes at the four corners
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        k.add("cyl8", pole, [sx * (w / 2 - 0.06), 0.07, sz * (d / 2 - 0.06)], [0.03, 0.14, 0.03], { outline: 0.004 });
        k.add("cyl8", rope, [sx * (w / 2 - 0.02), 0.04, sz * (d / 2 - 0.05)], [0.012, 0.1, 0.012], { rot: [Math.PI / 2, 0, 0], outline: false });
      }
    // the door's ties
    for (const sx of [-1, 1]) k.add("cyl8", rope, [sx * DOOR_W * 0.55, 0.45, d / 2 - 0.32], [0.03, 0.9, 0.03], { rot: [0.45, 0, 0], outline: 0.003 });
    if (!p.inUse) {
      const cloth = m(str(p, "cloth", "#f2d4d6"), "fabric");
      k.add(canopyGeometry(w, d), cloth, [0, 0, 0], 1, { outline: 0.008, normals: true });
    }
    void seed;
  },

  // A quilted mat: a padded rectangle with stitched squares and a bound edge.
  fortmat: (k, w, d, p, m) => {
    const base = m(str(p, "base", "#f1dfc4"), "fabric");
    const stitch = m(str(p, "stitch", "#c9a97a"), "fabric");
    const edge = m(str(p, "edge", "#d98a72"), "fabric");
    k.add("soft", base, [0, 0.014, 0], [w - 0.08, 0.026, d - 0.08], { outline: 0.004 });
    for (const [sx, sz, len, thin] of [
      [0, -d / 2 + 0.05, w - 0.12, true],
      [0, d / 2 - 0.05, w - 0.12, true],
      [-w / 2 + 0.05, 0, d - 0.12, false],
      [w / 2 - 0.05, 0, d - 0.12, false],
    ] as const)
      k.box(edge, [sx, 0.03, sz], thin ? [len, 0.008, 0.05] : [0.05, 0.008, len], { outline: false });
    // stitched squares, half a metre across
    for (let i = 1; i < Math.floor(w / 0.5); i++) k.box(stitch, [-w / 2 + i * 0.5, 0.032, 0], [0.012, 0.004, d - 0.2], { outline: false });
    for (let j = 1; j < Math.floor(d / 0.5); j++) k.box(stitch, [0, 0.032, -d / 2 + j * 0.5], [w - 0.2, 0.004, 0.012], { outline: false });
  },

  // A floor cushion: plump, with a button and a trim.
  fortcushion: (k, _w, _d, p, m) => {
    const cloth = m(str(p, "color", "#e8a6a0"), "fabric");
    k.add("soft", cloth, [0, 0.07, 0], [0.62, 0.13, 0.62], { outline: 0.007 });
    k.add("soft", m(str(p, "trim", "#fff1e0"), "fabric"), [0, 0.135, 0], [0.5, 0.03, 0.5], { outline: false });
    k.add("sphere", m("#c9786f", "fabric"), [0, 0.15, 0], [0.06, 0.03, 0.06], { outline: false });
  },

  // A plush bear in a scarf, sitting with its legs out.
  fortplush: (k, _w, _d, p, m) => {
    const fur = m(str(p, "fur", "#c99a6b"), "fabric");
    const belly = m(str(p, "belly", "#f0dcc0"), "fabric");
    const scarf = m(str(p, "scarf", "#e57f93"), "fabric");
    const ink = m("#3a2c26", "rubber");
    k.add("sphere", fur, [0, 0.19, 0], [0.34, 0.34, 0.3], { outline: 0.007 });
    k.add("sphere", belly, [0, 0.18, 0.1], [0.22, 0.24, 0.12], { outline: 0.004 });
    k.add("sphere", fur, [0, 0.43, 0.02], [0.27, 0.25, 0.25], { outline: 0.007 });
    for (const s of [-1, 1]) {
      k.add("sphere", fur, [s * 0.11, 0.56, 0], 0.11, { outline: 0.005 });
      k.add("sphere", belly, [s * 0.11, 0.56, 0.03], 0.06, { outline: false });
      k.add("sphere", fur, [s * 0.2, 0.22, 0.1], [0.12, 0.2, 0.12], { rot: [0, 0, s * 0.5], outline: 0.005 });
      k.add("sphere", fur, [s * 0.1, 0.06, 0.2], [0.13, 0.12, 0.2], { outline: 0.005 });
      k.add("sphere", ink, [s * 0.065, 0.46, 0.14], 0.03, { outline: false });
    }
    k.add("sphere", belly, [0, 0.41, 0.15], [0.12, 0.09, 0.08], { outline: 0.004 });
    k.add("sphere", ink, [0, 0.43, 0.2], 0.035, { outline: false });
    k.add("torus", scarf, [0, 0.3, 0.02], [0.2, 0.2, 0.2], { rot: [Math.PI / 2, 0, 0], outline: 0.004 });
    k.add("soft", scarf, [0.09, 0.2, 0.15], [0.07, 0.17, 0.03], { outline: 0.003 });
  },

  // A string of fairy lights hung from three hooks across the back, drawn dark when they're off (the glow is live).
  fairylights: (k, _w, _d, p, m) => {
    const wire = m(str(p, "wire", "#4a3f35"), "rubber");
    const bulb = m("#f1dfa8", "glass");
    const pts = bulbPositions();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = new THREE.Vector3(...pts[i]!);
      const b = new THREE.Vector3(...pts[i + 1]!);
      const delta = b.clone().sub(a);
      const g = new THREE.CylinderGeometry(0.006, 0.006, delta.length(), 5);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
      k.add(g, wire, a.clone().add(delta.multiplyScalar(0.5)).toArray() as [number, number, number], 1, { outline: false });
    }
    for (const q of pts) k.add("sphere", bulb, [q[0], q[1] - 0.03, q[2]], [0.045, 0.06, 0.045], { outline: false });
    for (const x of [-1.4, 0, 1.4]) k.add("sphere", wire, [x, BULB_Y + 0.04, 0.02], 0.03, { outline: false });
  },
};
