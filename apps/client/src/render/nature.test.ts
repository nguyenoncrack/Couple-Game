import { describe, expect, it } from "vitest";
import { buildNav, emptyBlueprint } from "@cg/shared";
import * as THREE from "three";
import { groundcoverLayout, MAX_COVER, MAX_LITTER } from "./groundcoverLayout";
import { meadowClearance } from "./meadowLayout";
import { boughGeometry, crownGeometry, grassGeometry, natureMaterial } from "./nature";
import { Kit } from "./kit";
import { pencilMaterial } from "./pencil";
import { lakeShape } from "./sceneryLayout";
import { WATERBIRDS, waterbirdPose } from "./waterbirdLayout";

it.each([[24, 20], [30, 26]])("natural cover for a %i × %i house preserves all gameplay clearances", (w, d) => {
  const bp = emptyBlueprint(w, d), level = bp.levels[0]!, before = JSON.stringify(bp), nav = buildNav(bp);
  const layout = groundcoverLayout(w, d, level), clear = meadowClearance(w, d, level);
  expect(layout).toEqual(groundcoverLayout(w, d, level));
  expect(layout.grass.length).toBeGreaterThan(2500);
  expect(layout.grass.length).toBeLessThanOrEqual(MAX_COVER);
  expect(layout.litter.length).toBeGreaterThan(100);
  expect(layout.litter.length).toBeLessThanOrEqual(MAX_LITTER);
  for (const p of [...layout.grass, ...layout.litter]) {
    expect(clear(p.x, p.z)).toBe(true);
    expect(p.x > 0 && p.x < w && p.z > 0 && p.z < d).toBe(false);
  }
  expect(JSON.stringify(bp)).toBe(before);
  expect(buildNav(bp)).toBe(nav);
});

describe("decorative waterbirds", () => {
  it.each([24, 30, 60])("keeps the entire family over open water for lot width %i", (w) => {
    const lake = lakeShape(w);
    for (let time = 0; time <= 3600; time += 7) for (let i = 0; i < WATERBIRDS; i++) {
      const p = waterbirdPose(w, i, time);
      expect(lake.inside(p.x, p.z, -2)).toBe(true);
      expect(Math.abs(p.x - (lake.cx + 3))).toBeGreaterThan(2);
      expect(Number.isFinite(p.turn)).toBe(true);
      expect(p.y).toBeGreaterThan(0.03);
    }
  });
  it("leaves space between the birds throughout their loop", () => {
    for (let time = 0; time < 150; time += 0.5) {
      const poses = Array.from({ length: WATERBIRDS }, (_, i) => waterbirdPose(24, i, time));
      for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) {
        const a = poses[i]!, b = poses[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan((a.scale + b.scale) * 0.3);
      }
    }
  });
  it("moves smoothly without a wrap teleport and retains stable follower sizes", () => {
    const a = waterbirdPose(24, 0, 100), b = waterbirdPose(24, 0, 100.016);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.01);
    expect(waterbirdPose(24, 4, 100).scale).toBeLessThan(a.scale);
    expect(waterbirdPose(24, 0, 100)).toEqual(a);
  });
});

it("isolates natural surfaces from pencil furniture and removes only their hull outlines", () => {
  const natural = natureMaterial("#7b8b55", { finish: "canopy", sway: 0.0015 });
  expect(natural).toBe(natureMaterial("#7b8b55", { finish: "canopy", sway: 0.0015 }));
  expect(natural).not.toBe(pencilMaterial("#7b8b55", { finish: "canopy", sway: 0.0015 }));
  const k = new Kit();
  k.add("sphere", natural, [0, 1, 0], 1);
  const meshes = k.build();
  expect(meshes).toHaveLength(1);
  expect(meshes[0]!.material).toBe(natural);
  expect(natural.defines.NATURAL).toBe(1);
  meshes.forEach((m) => m.geometry.dispose());
  const old = new Kit(); old.add("sphere", pencilMaterial("#7b8b55"), [0, 1, 0], 1);
  const drawn = old.build(); expect(drawn).toHaveLength(2); drawn.forEach((m) => m.geometry.dispose());
});

it("keeps shared outdoor geometry finite, bounded and reusable", () => {
  for (const create of [crownGeometry, boughGeometry, grassGeometry]) {
    const a = create(), b = create(), p = a.getAttribute("position");
    expect(Array.from(p.array)).toEqual(Array.from(b.getAttribute("position").array));
    expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
    expect(p.count).toBeLessThanOrEqual(200);
    a.computeBoundingBox();
    expect(a.boundingBox!.getSize(new THREE.Vector3()).length()).toBeLessThan(2);
    a.dispose(); b.dispose();
  }
});
