import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { outlineMaterial } from "./pencil";

/**
 * A kit for building detailed models cheaply (from the Museum of Nguyen): add boxes, cylinders and other shapes
 * with a material and an outline weight, and `build` merges everything sharing a material into one mesh (plus
 * one outline mesh per weight). A sofa with forty parts then costs a few draw calls. Each part remembers its own
 * center so its outline pushes out from it and box corners stay closed.
 */

function rounded(w: number, h: number, d: number, r: number) {
  // A soft-cornered box for cushions and mattresses: a box with bevelled extrusion.
  const shape = new THREE.Shape();
  const x = -w / 2 + r;
  const y = -h / 2 + r;
  shape.moveTo(x, -h / 2);
  shape.lineTo(-x, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, y);
  shape.lineTo(w / 2, -y);
  shape.quadraticCurveTo(w / 2, h / 2, -x, h / 2);
  shape.lineTo(x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, -y);
  shape.lineTo(-w / 2, y);
  shape.quadraticCurveTo(-w / 2, -h / 2, x, -h / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - r * 2, bevelEnabled: true, bevelSize: r * 0.9, bevelThickness: r, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(d - r * 2) / 2);
  // Extrusion bevels grow outside the path. Normalize the complete geometry so
  // callers' dimensions describe the actual cushion, including its rounded edge.
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  g.center();
  g.scale(w / size.x, h / size.y, d / size.z);
  g.computeVertexNormals();
  return g;
}

const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.CylinderGeometry(0.32, 0.5, 1, 16),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  half: new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  blob: new THREE.IcosahedronGeometry(0.5, 1),
  torus: new THREE.TorusGeometry(0.5, 0.08, 8, 24),
  /** Unit cushion with soft edges (scale it). */
  soft: rounded(1, 1, 1, 0.22),
  /** Gently rounded rigid housing, with flat faces for handles and trim. */
  roundbox: rounded(1, 1, 1, 0.06),
};
export type Shape = keyof typeof SHAPES;

type V3 = readonly [number, number, number];
export interface PartOpts {
  /** Rotation (radians), applied Y, then X, then Z. */
  rot?: V3;
  /** Outline thickness in metres; false or 0 for none. */
  outline?: number | false;
  /** Push outlines along normals instead of out from the center (thin or open shapes). */
  normals?: boolean;
}

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  m: THREE.Matrix4;
  outline: number;
  normals: boolean;
}

export interface BuiltMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export class Kit {
  parts: Part[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private e = new THREE.Euler(0, 0, 0, "YXZ");
  private q = new THREE.Quaternion();

  /** Everything added inside `fn` is placed relative to this offset and turn (a turn about y, or a full rotation
   * like a part's `rot`), and size if given. */
  at(pos: V3, turn: number | V3, fn: () => void, scale = 1) {
    const top = this.stack[this.stack.length - 1]!;
    if (typeof turn === "number") this.e.set(0, turn, 0);
    else this.e.set(turn[0], turn[1], turn[2]);
    this.q.setFromEuler(this.e);
    this.stack.push(top.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(scale, scale, scale))));
    fn();
    this.stack.pop();
  }

  add(shape: Shape | THREE.BufferGeometry, mat: THREE.Material, pos: V3, scale: V3 | number, opts: PartOpts = {}) {
    const s = typeof scale === "number" ? [scale, scale, scale] : scale;
    this.e.set(opts.rot?.[0] ?? 0, opts.rot?.[1] ?? 0, opts.rot?.[2] ?? 0);
    this.q.setFromEuler(this.e);
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(s[0], s[1], s[2]));
    const m = this.stack[this.stack.length - 1]!.clone().multiply(local);
    this.parts.push({ geo: typeof shape === "string" ? SHAPES[shape] : shape, mat, m, outline: opts.outline === false ? 0 : (opts.outline ?? 0.012), normals: Boolean(opts.normals) });
    return this;
  }

  box(mat: THREE.Material, pos: V3, scale: V3 | number, opts?: PartOpts) {
    return this.add("box", mat, pos, scale, opts);
  }

  /** Merge into one mesh per material (and one outline mesh per weight). */
  build(ghost = false): BuiltMesh[] {
    const bodies = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const lines = new Map<string, { thick: number; normals: boolean; sway: number; geos: THREE.BufferGeometry[] }>();
    const center = new THREE.Vector3();
    for (const p of this.parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
      // every part needs the same attributes to merge; uv lets a surface (pool water) know where its edges are
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
      g.applyMatrix4(p.m);
      center.setFromMatrixPosition(p.m);
      const n = g.attributes.position!.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.set([center.x, center.y, center.z], i * 3);
      g.setAttribute("aCenter", new THREE.BufferAttribute(c, 3));
      if (!bodies.has(p.mat)) bodies.set(p.mat, []);
      bodies.get(p.mat)!.push(g);
      if (p.outline > 0) {
        // a swaying part's outline sways with it
        const sway: number = p.mat.userData.sway ?? 0;
        const key = `${p.outline}|${p.normals}|${sway}`;
        if (!lines.has(key)) lines.set(key, { thick: p.outline, normals: p.normals, sway, geos: [] });
        lines.get(key)!.geos.push(g);
      }
    }
    const out: BuiltMesh[] = [];
    for (const { thick, normals, sway, geos } of lines.values()) out.push({ geometry: mergeGeometries(geos)!, material: outlineMaterial(thick, !normals, true, ghost, sway) });
    for (const [mat, geos] of bodies) out.push({ geometry: mergeGeometries(geos)!, material: mat });
    for (const o of out) o.geometry.computeBoundingSphere();
    return out;
  }
}
