import { catalog, cellKey, parseCell, type Level } from "@cg/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { roofVisible, useGame } from "../state/game";
import * as THREE from "three";
import { WALL_H } from "./House";
import { Kit } from "./kit";
import { shade } from "./models";
import { pencilMaterial } from "./pencil";

/**
 * Roofs. Each roofed cell is covered, and neighbouring roofed cells make one roof: its height anywhere is how far
 * that spot is from the roof's edge (measured square-wise, so slopes meet in straight hips and valleys), times the
 * pitch. A plain rectangle comes out as a hipped roof, an L as two hips joined by a valley. The roof hangs a little
 * past its edge as eaves, with a fascia board along them, a ridge cap along every hip and ridge, and a ceiling
 * underneath for when you're inside.
 */

/** Rise per metre run. */
export const PITCH = 0.55;
/** The roof's edge sits just on top of the walls. */
export const ROOF_BASE = WALL_H + 0.06;
const OVER = 0.38;
const THICK = 0.09;
/** Past this far in, the roof stops rising and goes flat (very wide houses). */
const MAX_IN = 8;

type Cells = Level["roofs"];

/** How far in from the roof's edge a point is: the square (Chebyshev) distance to the nearest unroofed cell. */
function inward(roofs: Cells, px: number, pz: number) {
  let best = MAX_IN;
  const x0 = Math.floor(px - best) - 1;
  const x1 = Math.ceil(px + best);
  const z0 = Math.floor(pz - best) - 1;
  const z1 = Math.ceil(pz + best);
  for (let x = x0; x <= x1; x++) {
    const dx = Math.max(x - px, 0, px - (x + 1));
    if (dx >= best) continue;
    for (let z = z0; z <= z1; z++) {
      const dz = Math.max(z - pz, 0, pz - (z + 1));
      const dist = Math.max(dx, dz);
      if (dist < best && !roofs[cellKey(x, z)]) best = dist;
    }
  }
  return best;
}

/**
 * Triangles of a roof's top, each cell cut into quarters along every line where the slope can change (half-metre
 * lines and diagonals through whole-metre corners), so each triangle is flat and hips come out straight.
 */
function topTriangles(roofs: Cells, cells: { x: number; z: number }[]) {
  const heights = new Map<string, number>();
  const at = (x: number, z: number): THREE.Vector3 => {
    const key = `${x}:${z}`;
    let h = heights.get(key);
    if (h === undefined) heights.set(key, (h = ROOF_BASE + inward(roofs, x, z) * PITCH));
    return new THREE.Vector3(x, h, z);
  };
  const tris: THREE.Vector3[][] = [];
  for (const c of cells) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const x = c.x + i / 2;
        const z = c.z + j / 2;
        const a = at(x, z);
        const b = at(x + 0.5, z);
        const cc = at(x + 0.5, z + 0.5);
        const d = at(x, z + 0.5);
        // counter-clockwise seen from above (y up, so x → z is clockwise: list a, d, c, b)
        if ((i + j) % 2 === 0) tris.push([a, d, cc], [a, cc, b]);
        else tris.push([a, d, b], [b, d, cc]);
      }
    }
  }
  return tris;
}

/** The eaves: a sloping strip out from each edge of the roof, mitred at corners. */
function eaves(roofs: Cells, cells: { x: number; z: number }[]) {
  const strips: { inner: [THREE.Vector3, THREE.Vector3]; outer: [THREE.Vector3, THREE.Vector3] }[] = [];
  const has = (x: number, z: number) => Boolean(roofs[cellKey(x, z)]);
  const low = ROOF_BASE - OVER * PITCH;
  for (const c of cells) {
    // each side: the outward direction, and the edge's two ends in order along it
    for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      if (has(c.x + nx, c.z + nz)) continue;
      const tx = -nz;
      const tz = nx;
      // edge midpoint and its two ends
      const mx = c.x + 0.5 + nx * 0.5;
      const mz = c.z + 0.5 + nz * 0.5;
      const ends = [-1, 1].map((s) => {
        const ex = mx + tx * 0.5 * s;
        const ez = mz + tz * 0.5 * s;
        // what's beyond this end, along the edge: more roof (straight on, or turning in) or none (a corner)
        const ahead = has(c.x + tx * s, c.z + tz * s);
        const aheadOut = has(c.x + tx * s + nx, c.z + tz * s + nz);
        const stretch = !ahead ? OVER : aheadOut ? -OVER : 0;
        return {
          inner: new THREE.Vector3(ex, ROOF_BASE, ez),
          outer: new THREE.Vector3(ex + nx * OVER + tx * stretch * s, low, ez + nz * OVER + tz * stretch * s),
        };
      });
      strips.push({ inner: [ends[0]!.inner, ends[1]!.inner], outer: [ends[0]!.outer, ends[1]!.outer] });
    }
  }
  return strips;
}

/** A triangle soup as a geometry, flat shaded. */
function soup(tris: THREE.Vector3[][], flip = false, drop = 0) {
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    const order = flip ? [t[0]!, t[2]!, t[1]!] : t;
    order.forEach((v, j) => pos.set([v.x, v.y - drop, v.z], i * 9 + j * 3));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Edges where two flat pieces of the top meet in a ridge or hip (not a valley), for the ridge caps. */
function ridges(tris: THREE.Vector3[][]) {
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 2)}:${Math.round(v.z * 2)}`;
  const normal = (t: THREE.Vector3[]) => new THREE.Vector3().subVectors(t[1]!, t[0]!).cross(new THREE.Vector3().subVectors(t[2]!, t[0]!)).normalize();
  const byEdge = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; tris: THREE.Vector3[][] }>();
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const a = t[i]!;
      const b = t[(i + 1) % 3]!;
      const k = [key(a), key(b)].sort().join("|");
      const e = byEdge.get(k) ?? { a, b, tris: [] };
      e.tris.push(t);
      byEdge.set(k, e);
    }
  }
  const out: [THREE.Vector3, THREE.Vector3][] = [];
  for (const { a, b, tris: pair } of byEdge.values()) {
    if (pair.length !== 2) continue;
    const [p, q] = pair as [THREE.Vector3[], THREE.Vector3[]];
    const np = normal(p);
    if (np.dot(normal(q)) > 0.97) continue;
    // a ridge if the other piece's far corner drops below this piece's plane
    const far = q.find((v) => v !== a && v !== b && key(v) !== key(a) && key(v) !== key(b))!;
    if (np.dot(new THREE.Vector3().subVectors(far, a)) < -1e-4) out.push([a, b]);
  }
  return out;
}

export function buildRoof(k: Kit, roofs: Cells, ghost?: THREE.Material) {
  const byStyle = new Map<string, { x: number; z: number }[]>();
  for (const [key, r] of Object.entries(roofs)) {
    const c = parseCell(key);
    if (!c) continue;
    const list = byStyle.get(r.style) ?? [];
    list.push(c);
    byStyle.set(r.style, list);
  }
  const trim = ghost ?? pencilMaterial("#f4efe6", { rim: false });
  for (const [styleId, cells] of byStyle) {
    const style = catalog.roofStyles.get(styleId);
    const top = ghost ?? pencilMaterial(style?.color ?? "#c9694a", { finish: "shingle" });
    const ceiling = ghost ?? pencilMaterial(style?.ceiling ?? "#f4ecdf", { finish: "plaster", rim: false, fill: 0.35 });
    const cap = ghost ?? pencilMaterial(shade(style?.color ?? "#c9694a", 0.78), { rim: false });

    const tris = topTriangles(roofs, cells);
    const strips = eaves(roofs, cells);
    const eaveTris = strips.flatMap(({ inner: [a, b], outer: [c, d] }) => {
      // wind so the strip faces up, whichever way round the edge runs
      const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 0;
      return up ? [[a, b, c], [b, d, c]] : [[a, c, b], [b, c, d]];
    });
    const surface = [...tris, ...eaveTris];
    k.add(soup(surface), top, [0, 0, 0], 1, { outline: false });
    k.add(soup(surface, true, THICK), ceiling, [0, 0, 0], 1, { outline: false });

    // fascia boards along the eaves' outer edge
    const fascia: THREE.Vector3[][] = [];
    for (const { outer: [c, d] } of strips) {
      const c2 = c.clone().setY(c.y - THICK - 0.04);
      const d2 = d.clone().setY(d.y - THICK - 0.04);
      fascia.push([c, d, d2], [c, d2, c2], [c, d2, d], [c, c2, d2]);
    }
    if (fascia.length) k.add(soup(fascia), trim, [0, 0, 0], 1, { outline: false });

    if (!ghost) {
      for (const [a, b] of ridges(tris)) {
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const along = b.clone().sub(a);
        const g = new THREE.CylinderGeometry(0.05, 0.05, along.length() + 0.04, 6);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
        k.add(g, cap, [mid.x, mid.y + 0.02, mid.z], 1, { outline: 0.008, normals: true });
      }
    }
  }
}

/**
 * The roofs of a level, when they're shown. They cast no shadow (`userData.noShadow`): under one, the whole house
 * would sit in shade and read as under something tall, where a cosy house should stay lit as if through its
 * windows. With `onDown`, a press on the roof is caught (and not passed through to the ground beyond it).
 */
export function Roofs({ roofs, onDown }: { roofs: Cells; onDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  const shown = useGame(roofVisible);
  return shown ? <RoofMeshes roofs={roofs} onDown={onDown} /> : null;
}

function RoofMeshes({ roofs, onDown }: { roofs: Cells; onDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  const built = useMemo(() => {
    const k = new Kit();
    buildRoof(k, roofs);
    return k.parts.length ? k.build() : [];
  }, [roofs]);
  useEffect(() => () => built.forEach((b) => b.geometry.dispose()), [built]);
  return (
    <group name="roofs" onPointerDown={onDown}>
      {built.map((b, i) => (
        <mesh key={i} geometry={b.geometry} material={b.material} raycast={onDown ? undefined : () => null} userData={{ noShadow: true }} />
      ))}
    </group>
  );
}
