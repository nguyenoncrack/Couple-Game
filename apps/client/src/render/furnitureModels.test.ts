import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { catalog } from "@cg/shared";
import { FURNITURE_KINDS } from "./furnitureModels";
import { modelFor } from "./models";

const items = [...catalog.furniture.values()];

/** The highest point of an item's model at (x, z) (from its centre, in its own frame) below `from`, if any. */
function top(id: string, x: number, z: number, from = 4) {
  const meshes = modelFor(catalog.furniture.get(id)!).filter((m) => m.material.side !== THREE.BackSide).map(({ geometry, material }) => new THREE.Mesh(geometry, material));
  return new THREE.Raycaster(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes, false)[0]?.point.y;
}

describe("furniture expansion models", () => {
  it.each(FURNITURE_KINDS)("%s is used by the catalog", (kind) => {
    expect(items.some((i) => i.model.kind === kind)).toBe(true);
  });

  it("keeps the open front of the corner sectional clear, so you can walk there", () => {
    for (const id of ["sectional_oat", "sectional_slate", "sectional_terracotta"]) {
      const item = catalog.furniture.get(id)!;
      const [w, d] = item.footprint;
      for (const [cx, cz] of item.walkable!)
        for (const [fx, fz] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.85], [0.15, 0.85], [0.85, 0.15]] as const) expect(top(id, cx + fx - w / 2, cz + fz - d / 2), `${id} ${cx},${cz}`).toBeUndefined();
      // and the seats and chaise are there to sit on
      expect(top(id, 0.67 - w / 2, 0.45 - d / 2)).toBeGreaterThan(0.4);
      expect(top(id, 2.45 - w / 2, 1.15 - d / 2)).toBeGreaterThan(0.4);
    }
  });

  it("seats you where the chair is: at the desk, on the benches, in the shower tray", () => {
    for (const id of ["desk_oak", "bench_oak", "picnic_natural", "shower_white"]) {
      const item = catalog.furniture.get(id)!;
      const [w, d] = item.footprint;
      for (const it of item.interactions!)
        for (const s of it.slots) {
          // (looking down from just above where you sit, under the table top or the shower head)
          const y = top(id, s.pose[0] - w / 2, s.pose[1] - d / 2, s.y + 0.2);
          expect(y, `${id} at ${s.pose}`).toBeDefined();
          // the seat (or tray) is right under you, not something you'd sink into or float over
          expect(Math.abs(y! - s.y), `${id} at ${s.pose}`).toBeLessThan(0.12);
        }
    }
  });
});
