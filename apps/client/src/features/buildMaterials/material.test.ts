import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { catalog } from "@cg/shared";
import { Kit } from "../../render/kit";
import { lighting, pencilMaterial } from "../../render/pencil";
import { buildingMaterial } from "./material";
import { buildWall } from "./wallGeometry";

it("caches building profiles separately and keeps live lighting uniforms connected", () => {
  const a = buildingMaterial("wall", "brick_red");
  expect(a).toBe(buildingMaterial("wall", "brick_red"));
  expect(a).not.toBe(buildingMaterial("floor", "parquet"));
  expect(a.uniforms.uTime).toBe(lighting.time);
  expect(a.uniforms.uShadowMap).toBe(lighting.shadowMap);
  expect(a.uniforms.uHeightMap).toBe(lighting.heightMap);
  expect(a).not.toBe(pencilMaterial("#b96648"));
  expect(buildingMaterial("floor", "legacy-unknown")).toBe(buildingMaterial("floor", "oak"));
});

it("uses optional catalog metadata with a fallback for older custom material definitions", () => {
  catalog.wallStyles.set("legacy", { id: "legacy", color: "#cccccc", name: "Legacy", finish: "brick" });
  expect(buildingMaterial("wall", "legacy").userData.buildSurface).toBe("brick");
  catalog.wallStyles.delete("legacy");
});

it("renders glass as double-sided transparency without writing an opaque depth wall", () => {
  const glass = buildingMaterial("wall", "glass_framed");
  expect(glass.transparent).toBe(true); expect(glass.depthWrite).toBe(false);
  expect(glass.side).toBe(THREE.DoubleSide); expect(glass.uniforms.uAlpha!.value).toBeCloseTo(.24);
  expect(buildingMaterial("wall", "glass_framed", "bad").uniforms.uHighlightAmt!.value).toBe(.3);
  expect(buildingMaterial("wall", "brick_red").transparent).toBe(false);
});

describe.each(["h", "v"] as const)("glass %s walls", (dir) => {
  it("retains doorway/window holes and opaque framing in full and lowered walls", () => {
    for (const height of [2.7, .32]) {
      const k = new Kit(), glass = buildingMaterial("wall", "glass_framed");
      buildWall(k, { dir, at: 0, from: 0, to: 4, style: "glass_framed" }, height, glass, pencilMaterial(), [{ from: 1, to: 2, sill: 0, top: 2.2 }, { from: 2.5, to: 3.5, sill: .9, top: 2 }]);
      const built = k.build(), meshes = built.map((b) => new THREE.Mesh(b.geometry, b.material));
      const hits = (along: number, y: number) => new THREE.Raycaster(dir === "h" ? new THREE.Vector3(along, y, 2) : new THREE.Vector3(2, y, along), dir === "h" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0), 0, 4).intersectObjects(meshes).length;
      expect(hits(1.5, Math.min(height / 2, 1))).toBe(0);
      if (height > 2) expect(hits(2.8, 1.4)).toBe(0);
      expect(hits(.5, height / 2)).toBeGreaterThan(0);
      expect(built.some((b) => b.material !== glass && !b.material.transparent)).toBe(true);
      built.forEach((b) => b.geometry.dispose());
    }
  });
});
