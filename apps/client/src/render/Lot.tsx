import { useMemo } from "react";
import * as THREE from "three";
import { KitMesh } from "./KitMesh";
import { shade } from "./models";
import { pencilMaterial } from "./pencil";

/**
 * The world around the house: lawn, a picket fence along the back and sides, a pavement and a quiet street out
 * front (+z), hedges and trees. Purely decorative for now.
 */

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function Lot({ w, d }: { w: number; d: number }) {
  const lawn = pencilMaterial("#9cb57a", { finish: "lawn", rim: false });
  const ground = useMemo(() => new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), []);

  return (
    <group>
      <mesh geometry={ground} material={lawn} position={[w / 2, -0.01, d / 2]} raycast={() => null} />
      <KitMesh
        deps={[w, d]}
        make={(k) => {
          const picket = pencilMaterial("#f5f0e4");
          const post = pencilMaterial("#ece4d2");
          const fence = (x1: number, z1: number, x2: number, z2: number) => {
            const len = Math.hypot(x2 - x1, z2 - z1);
            const ry = Math.atan2(-(z2 - z1), x2 - x1);
            k.at([x1, 0, z1], ry, () => {
              k.box(post, [len / 2, 0.55, 0], [len, 0.06, 0.04], { outline: 0.008 });
              k.box(post, [len / 2, 0.25, 0], [len, 0.06, 0.04], { outline: 0.008 });
              for (let t = 0.1; t < len; t += 0.18) {
                k.box(picket, [t, 0.42, 0.03], [0.08, 0.74, 0.025], { outline: 0.006 });
                k.add("cone", picket, [t, 0.82, 0.03], [0.08, 0.06, 0.025], { outline: false });
              }
              for (let t = 0; t <= len + 0.01; t += 2) k.box(post, [t, 0.45, 0], [0.1, 0.9, 0.1], { outline: 0.008 });
            });
          };
          const o = 0.6;
          fence(-o, -o, w + o, -o);
          fence(-o, d + 0.2, -o, -o);
          fence(w + o, -o, w + o, d + 0.2);

          // pavement and street along the front
          const pave = pencilMaterial("#d4cfc4", { finish: "setts", rim: false });
          const road = pencilMaterial("#8d8a84", { finish: "concrete", rim: false });
          const kerb = pencilMaterial("#cfc9bd");
          k.box(pave, [w / 2, 0.02, d + 2], [w + 60, 0.04, 2.4], { outline: false });
          k.box(kerb, [w / 2, 0.06, d + 3.25], [w + 60, 0.12, 0.2], { outline: 0.008 });
          k.box(road, [w / 2, -0.005, d + 7.4], [w + 60, 0.01, 8], { outline: false });
          for (let x = -26; x < w + 30; x += 4) k.box(pencilMaterial("#f2ead2"), [x, 0.002, d + 7.4], [2, 0.006, 0.18], { outline: false });

          // trees and hedges, scattered the same way every time
          const r = rng(7);
          const tree = (x: number, z: number, s: number) => {
            k.add("cyl8", pencilMaterial("#8a6a4c", { finish: "wood" }), [x, 1.2 * s, z], [0.22 * s, 2.4 * s, 0.22 * s]);
            const leaf = "#5f9e4f";
            for (let i = 0; i < 6; i++) {
              const a = r() * Math.PI * 2;
              const rr = r() * 0.9 * s;
              k.add("blob", pencilMaterial(shade(leaf, 0.85 + r() * 0.3)), [x + Math.cos(a) * rr, (2.6 + r() * 1.3) * s, z + Math.sin(a) * rr], (1.3 + r() * 0.8) * s, { outline: 0.02 });
            }
          };
          tree(-4, 3, 1.1);
          tree(-5, d - 3, 0.9);
          tree(w + 4.5, 4, 1.2);
          tree(w + 5, d - 2, 0.95);
          tree(w * 0.3, -4.5, 1.15);
          tree(w * 0.75, -5, 1.0);
          for (let x = 0.5; x < w; x += 1.1) k.add("blob", pencilMaterial(shade("#6c9e57", 0.9 + r() * 0.2)), [x, 0.45, -o - 0.7], [1.3, 0.9 + r() * 0.3, 0.9], { outline: 0.012 });
        }}
      />
      <LotBorder w={w} d={d} />
    </group>
  );
}

/** A faint dashed pencil line around the buildable lot. */
function LotBorder({ w, d }: { w: number; d: number }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const dash = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      for (let t = 0; t < len; t += 0.5) {
        const a = t / len;
        const b = Math.min(t + 0.28, len) / len;
        pts.push(x1 + (x2 - x1) * a, 0.03, z1 + (z2 - z1) * a, x1 + (x2 - x1) * b, 0.03, z1 + (z2 - z1) * b);
      }
    };
    dash(0, 0, w, 0);
    dash(w, 0, w, d);
    dash(w, d, 0, d);
    dash(0, d, 0, 0);
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }, [w, d]);
  return (
    <lineSegments geometry={geo} raycast={() => null}>
      <lineBasicMaterial color="#3a3631" transparent opacity={0.4} />
    </lineSegments>
  );
}
