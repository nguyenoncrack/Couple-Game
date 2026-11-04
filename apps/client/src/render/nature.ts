import * as THREE from "three";
import type { Kit } from "./kit";
import { pencilMaterial, type PencilOptions } from "./pencil";

/** Outdoor surfaces share the game's sunlight/fog pipeline while dropping its drawn-paper treatment. */
export function natureMaterial(tone: string, opts: PencilOptions = {}) {
  return pencilMaterial(tone, { ...opts, rim: false, natural: true });
}

/** Lobed crowns and scalloped boughs; shared smooth geometry, with simpler silhouettes in the far woods. */
export function crownGeometry() {
  const g = new THREE.SphereGeometry(0.5, 12, 8);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const wave = 1 + 0.12 * Math.sin(x * 23 + y * 9) * Math.cos(z * 19 - y * 13) + 0.08 * Math.cos(x * 37 + z * 29);
    p.setXYZ(i, x * wave, y * wave, z * wave);
  }
  g.computeVertexNormals();
  return g;
}

export function boughGeometry() {
  const g = new THREE.ConeGeometry(0.5, 1, 10, 4);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const spread = 1 + Math.sin(a * 6 + y * 9) * 0.16 + Math.cos(a * 11 - y * 13) * 0.09;
    p.setXYZ(i, x * spread, y - Math.hypot(x, z) * 0.12 * (0.5 + 0.5 * Math.sin(a * 6)), z * spread);
  }
  g.computeVertexNormals();
  return g;
}

export const CROWN = crownGeometry();
export const BOUGH = boughGeometry();

/** A branch/root between points. Uses shared cylinders, with no new per-tree material or physics object. */
export function treeLimb(k: Kit, material: THREE.Material, from: [number, number, number], to: [number, number, number], diameter: number) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to), direction = end.clone().sub(start);
  const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()), "YXZ");
  k.add("cyl8", material, start.add(end).multiplyScalar(0.5).toArray() as [number, number, number], [diameter, direction.length(), diameter], { rot: [turn.x, turn.y, turn.z], outline: false });
}

/** Narrow curved blades in a clump, not image cards. Doubled faces remain visible at walking height. */
export function grassGeometry() {
  const vertices: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, h = 0.18 + (i % 4) * 0.055, lean = 0.08 + (i % 3) * 0.035;
    const cx = Math.cos(a) * 0.14, cz = Math.sin(a) * 0.14;
    const point = (t: number, side: number) => [cx + Math.cos(a) * lean * t * t + Math.sin(a) * side, h * t, cz + Math.sin(a) * lean * t * t - Math.cos(a) * side];
    const v = [point(0, -0.012), point(0, 0.012), point(0.55, -0.008), point(0.55, 0.008), point(1, 0)];
    for (const [a, b, c] of [[0, 1, 2], [1, 3, 2], [2, 3, 4]] as const) vertices.push(...v[a]!, ...v[b]!, ...v[c]!, ...v[c]!, ...v[b]!, ...v[a]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  return g;
}

