import * as THREE from "three";
import { expect, it } from "vitest";
import { DEFAULT_APPEARANCE, HAIRSTYLES, OUTFITS } from "./appearance";
import { buildPreviewCharacter } from "./characterParts";

for (const gender of ["guy", "girl"] as const) for (const hairstyle of HAIRSTYLES[gender]) {
  it(`${gender}/${hairstyle.id} builds every outfit with grounded, finite visual geometry`, () => {
    for (const outfit of OUTFITS) {
      const meshes = buildPreviewCharacter({ ...DEFAULT_APPEARANCE, gender, hairstyle: hairstyle.id, outfit: outfit.id });
      const box = new THREE.Box3();
      for (const { geometry, material } of meshes) {
        expect([...geometry.getAttribute("position").array].every(Number.isFinite)).toBe(true);
        expect([...geometry.getAttribute("normal").array].every(Number.isFinite)).toBe(true);
        if (material.side !== THREE.BackSide) {
          geometry.computeBoundingBox(); box.union(geometry.boundingBox!);
        }
        geometry.dispose();
      }
      expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(box.min.y).toBeLessThan(0.025);
      expect(box.max.y).toBeLessThan(1.9);
      expect(box.min.x).toBeGreaterThanOrEqual(-0.3);
      expect(box.max.x).toBeLessThanOrEqual(0.3);
      expect(box.min.z).toBeGreaterThanOrEqual(-0.3);
      expect(box.max.z).toBeLessThanOrEqual(0.3);
    }
  });
}
