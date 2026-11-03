import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { applyOp, catalog, emptyBlueprint, type Blueprint, type Op } from "@cg/shared";
import { addWall, wallGroups, WALL_H, WALL_DOWN_H } from "./House";
import { Kit } from "./kit";

// These tests exercise wall geometry without mounting the live game store.
vi.mock("../state/game", () => ({ useGame: () => null }));

function apply(bp: Blueprint, op: Op) {
  const result = applyOp(bp, op);
  if (!result.ok) throw Error(result.reason);
  return result.blueprint;
}

describe("openings across wall finish changes", () => {
  const cases = (["h", "v"] as const).flatMap((dir) =>
    ["garage_door", "door_french", "window_wide"].flatMap((catalogId) =>
      [false, true].map((flip) => ({ dir, catalogId, flip }))),
  );
  it.each(cases)("cuts all sections and draws one $catalogId model ($dir, flip=$flip)", ({ dir, catalogId, flip }) => {
    const item = catalog.openings.get(catalogId)!;
    let bp = emptyBlueprint(12, 12);
    const edges = Array.from({ length: 8 }, (_, i) => dir === "h" ? `h:${i + 1}:6` : `v:6:${i + 1}`);
    bp = apply(bp, { t: "walls.add", level: 0, edges, style: "brick_red" });
    bp = apply(bp, { t: "opening.place", level: 0, id: "opening001", catalogId, dir, x: dir === "h" ? 3 : 6, z: dir === "h" ? 6 : 3, flip });
    bp = apply(bp, { t: "walls.add", level: 0, edges: [edges[3 + item.width - 2]!], style: "plaster_cream" });
    const level = bp.levels[0]!;
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const groups = wallGroups(level);
    expect(groups.flatMap((g) => g.models).map(({ o }) => o.id)).toEqual(["opening001"]);
    expect(groups.filter((g) => g.openings.length)).toHaveLength(2);
    for (const height of [WALL_H, WALL_DOWN_H]) {
      const kit = new Kit();
      for (const { run, openings } of groups) {
        const gaps = openings.map(({ o, item }) => ({ from: dir === "h" ? o.x : o.z, to: (dir === "h" ? o.x : o.z) + item.width, sill: item.sill, top: item.top }));
        addWall(kit, run, height, mat, mat, gaps);
      }
      const built = kit.build();
      const meshes = built.filter((b) => b.material === mat).map((b) => new THREE.Mesh(b.geometry, b.material));
      const hits = (along: number, y: number) => {
        const from = dir === "h" ? new THREE.Vector3(along, y, 8) : new THREE.Vector3(8, y, along);
        const direction = dir === "h" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0);
        return new THREE.Raycaster(from, direction, 0, 4).intersectObjects(meshes).length;
      };
      const y = Math.min(height, item.top) / 2 + Math.min(height, item.sill) / 2;
      // All segments clear, including the repainted last metre; window sills stay solid.
      for (let along = 3.5; along < 3 + item.width; along++) {
        if (height > item.sill) expect(hits(along, y), `opening at ${along}`).toBe(0);
        else expect(hits(along, height / 2)).toBeGreaterThan(0);
      }
      expect(hits(2.5, height / 2)).toBeGreaterThan(0);
      expect(hits(3 + item.width + 0.5, height / 2)).toBeGreaterThan(0);
      if (height > item.top) expect(hits(3.5, item.top + 0.15)).toBeGreaterThan(0);
      if (item.sill > 0) expect(hits(3.5, Math.min(height, item.sill) / 2)).toBeGreaterThan(0);
      for (const mesh of built) mesh.geometry.dispose();
    }
    mat.dispose();
  });
});
