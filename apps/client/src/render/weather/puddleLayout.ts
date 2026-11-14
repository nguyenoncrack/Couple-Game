import { catalog, coverAt, type Blueprint, type ShelterMap } from "@cg/shared";
import * as THREE from "three";
import { trailCurve, trailNetwork } from "../trailLayout";

/**
 * Where puddles gather after rain: along the footpaths, in the low places a walker's feet wear down. Fixed by the
 * lot size (so both screens put them in the same spots) and only *shown* in proportion to how wet it is (see
 * Puddles.tsx).
 */
export interface Puddle {
  x: number;
  z: number;
  /** Radii along and across the path, metres. */
  rx: number;
  rz: number;
  /** Which way it lies (radians). */
  angle: number;
  /** 0..1, for when it shows (bigger, lower ones first) and for its ripples. */
  seed: number;
  /** How wet it has to be before this one appears (0..1). */
  need: number;
}

export const MAX_PUDDLES = 96;

const made = new Map<string, Puddle[]>();

export function puddleSpots(w: number, d: number): Puddle[] {
  const key = `${w}:${d}`;
  const hit = made.get(key);
  if (hit) return hit;
  const net = trailNetwork(w, d);
  const out: Puddle[] = [];
  let s = 90210 + w * 31 + d;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const trail of net.trails) {
    const curve = trailCurve(trail.points);
    const length = curve.getLength();
    const count = Math.floor(length / 3.2);
    for (let i = 0; i < count; i++) {
      // every so often along the path, a little to one side of its middle
      const u = (i + 0.2 + r() * 0.6) / count;
      const p = curve.getPointAt(Math.min(0.999, u));
      const tan = curve.getTangentAt(Math.min(0.999, u));
      const side = (r() - 0.5) * trail.width * 0.5;
      const size = 0.35 + r() * 0.6;
      out.push({
        x: p.x - tan.z * side,
        z: p.z + tan.x * side,
        rx: size * (1.1 + r() * 0.5),
        rz: size,
        angle: Math.atan2(tan.x, tan.z) + (r() - 0.5) * 0.6,
        seed: r(),
        need: r() * 0.8,
      });
    }
  }
  // the campsite's own paths too
  for (const pts of net.campTrails) {
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const count = Math.floor(curve.getLength() / 3);
    for (let i = 0; i < count; i++) {
      const p = curve.getPointAt((i + 0.3 + r() * 0.4) / count);
      const size = 0.3 + r() * 0.45;
      out.push({ x: p.x + (r() - 0.5) * 0.6, z: p.z + (r() - 0.5) * 0.6, rx: size * 1.3, rz: size, angle: r() * Math.PI, seed: r(), need: r() * 0.8 });
    }
  }
  const spots = out.slice(0, MAX_PUDDLES);
  made.set(key, spots);
  return spots;
}

/** Surfaces a player lays outdoors for walking on: rain pools on them. */
const PATHS = new Set(["stone", "setts", "concrete", "brick"]);

/**
 * Puddles on the paths *you* build: paved ground-floor cells that are open to the sky (not under a roof, or in a room
 * shut in by walls). Fixed by the cell, so both screens agree, and a different handful of the cells each time.
 */
export function gardenPuddles(bp: Blueprint, shelter: ShelterMap, room: number): Puddle[] {
  const out: Puddle[] = [];
  const level = bp.levels[0];
  if (!level || room <= 0) return out;
  for (const [key, tile] of Object.entries(level.tiles)) {
    const finish = catalog.floorMaterials.get(tile.material)?.finish;
    if (!finish || !PATHS.has(finish)) continue;
    const [x, z] = key.split(":").map(Number) as [number, number];
    if (coverAt(shelter, x + 0.5, z + 0.5) > 0) continue;
    // a steady scatter of the cells: roughly one in three
    const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    if (h > 0.34) continue;
    const h2 = (h * 97.31) % 1;
    const size = 0.28 + h2 * 0.3;
    out.push({ x: x + 0.25 + h2 * 0.5, z: z + 0.25 + ((h * 31.7) % 1) * 0.5, rx: size * 1.3, rz: size, angle: h2 * Math.PI, seed: (h * 13.7) % 1, need: (h * 7.3) % 1 * 0.8 });
    if (out.length >= room) break;
  }
  return out;
}
