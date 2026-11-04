import { catalog, cellKey, edgeKey, footprintOf, parseCell, parseEdge, type Level } from "@cg/shared";
import * as THREE from "three";
import { campLayout, lakeShape, STREET_REACH } from "./sceneryLayout";
import { scenesLayout } from "./scenesLayout";
import { shoreLayout } from "./shoreLayout";
import { nearTrail, trailNetwork } from "./trailLayout";

export interface Sprig { x: number; z: number; turn: number; scale: number; kind: number }
export interface MeadowLayout { grass: Sprig[]; flowers: Sprig[] }
const PAD = 0.35; // covers the whole plant, including leaning leaves

/** Cosmetic clearance only: never feeds back into navigation, state or build rules. */
export function meadowClearance(w: number, d: number, level: Level) {
  const lake = lakeShape(w);
  const camp = campLayout(d);
  const net = trailNetwork(w, d);
  const onTrail = nearTrail(net);
  const shore = shoreLayout(w, d);
  const shoreClear = [...shore.clearings, ...shore.seat.stones.map(([x, z]) => ({ x, z, r: 0.45 })), ...scenesLayout(w, d).clearings];
  const boxes = [...Object.keys(level.tiles), ...Object.keys(level.roofs)].flatMap((key) => {
    const cell = parseCell(key);
    return cell ? [{ x: cell.x, z: cell.z, w: 1, d: 1 }] : [];
  });
  for (const object of Object.values(level.objects)) {
    const item = catalog.furniture.get(object.catalogId);
    if (item) boxes.push(footprintOf(item, object));
  }
  const walls = Object.keys(level.walls).map(parseEdge).filter((v) => v !== null);
  // Flood the outdoor cells without crossing any walls, including doors. Bare enclosed rooms stay clear too.
  const outside = new Set<string>();
  const queue: [number, number][] = [];
  const add = (x: number, z: number) => {
    const key = cellKey(x, z);
    if (x < 0 || z < 0 || x >= w || z >= d || outside.has(key)) return;
    outside.add(key); queue.push([x, z]);
  };
  for (let x = 0; x < w; x++) {
    if (!level.walls[edgeKey("h", x, 0)]) add(x, 0);
    if (!level.walls[edgeKey("h", x, d)]) add(x, d - 1);
  }
  for (let z = 0; z < d; z++) {
    if (!level.walls[edgeKey("v", 0, z)]) add(0, z);
    if (!level.walls[edgeKey("v", w, z)]) add(w - 1, z);
  }
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const edge = dx ? edgeKey("v", x + (dx > 0 ? 1 : 0), z) : edgeKey("h", x, z + (dz > 0 ? 1 : 0));
      if (!level.walls[edge]) add(x + dx, z + dz);
    }
  }
  return (x: number, z: number) => {
    if (lake.inside(x, z, 1.5)) return false;
    // Pavement/street, playground bark and slide exit, cabin/porch and campfire circle.
    if (z > d + 0.5 && z < d + 12 && Math.abs(x - w / 2) < STREET_REACH) return false;
    if (Math.abs(x - (w + 5)) < 4.1 && Math.abs(z - (d / 2 + 0.5)) < 4.8) return false;
    if (Math.abs(x - camp.cabin.x) < 3.7 && Math.abs(z - camp.cabin.z) < 3) return false;
    if (Math.hypot(x - camp.fire[0], z - camp.fire[2]) < 3.85) return false;
    if (onTrail(x, z, 1.05) || net.bare.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 1.15)) return false;
    if (shoreClear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.3)) return false;
    // Fence and front entrance strip; the lawn itself remains open for walking/building.
    if ((Math.abs(x + 0.6) < 0.5 || Math.abs(x - w - 0.6) < 0.5) && z > -1.1 && z < d + 0.7) return false;
    if (Math.abs(z + 0.6) < 0.6 && x > -1.1 && x < w + 1.1) return false;
    if (x >= 0 && x < w && z >= 0 && z < d) {
      if (z > d - 0.9 || !outside.has(cellKey(Math.floor(x), Math.floor(z)))) return false;
    }
    if (boxes.some((b) => x > b.x - PAD && x < b.x + b.w + PAD && z > b.z - PAD && z < b.z + b.d + PAD)) return false;
    if (walls.some((e) => e.dir === "h"
      ? Math.abs(z - e.z) < PAD && x > e.x - PAD && x < e.x + 1 + PAD
      : Math.abs(x - e.x) < PAD && z > e.z - PAD && z < e.z + 1 + PAD)) return false;
    return true;
  };
}

/** Fixed seed and bounded counts. Filtering never shifts the surviving plants when a house is edited. */
export function meadowLayout(w: number, d: number, level: Level): MeadowLayout {
  let seed = 83717;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const clear = meadowClearance(w, d, level);
  const grass: Sprig[] = [], flowers: Sprig[] = [];
  for (let i = 0; i < 270; i++) {
    // Mixed broad countryside clumps and smaller, sparser lawn patches.
    const near = i < 90;
    const cx = near ? -8 + r() * (w + 16) : w / 2 + (r() - 0.5) * (w + 110);
    const cz = near ? -7 + r() * (d + 8) : d / 2 + (r() - 0.5) * (d + 100);
    const blooms = i % 3 === 0;
    const kind = i % 9 === 0 ? 2 : i % 2;
    for (let j = 0; j < 10; j++) {
      const a = r() * Math.PI * 2, radius = Math.sqrt(r()) * (near ? 1.1 : 2.1);
      const sprig = { x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius, turn: r() * Math.PI * 2, scale: 0.65 + r() * 0.65, kind };
      if (clear(sprig.x, sprig.z)) (blooms && j < 5 ? flowers : grass).push(sprig);
    }
  }
  return { grass, flowers };
}
