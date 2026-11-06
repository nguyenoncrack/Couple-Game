import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { catalog } from "@cg/shared";
import data from "../../../../../packages/shared/src/catalog/furniture-expansion.json";
import { EXPANSION_BUILDERS } from "./models";
import { modelFor } from "../../render/models";
import { searchCatalog } from "../../ui/filterCatalog";

const meshes = (id: string) => modelFor(catalog.furniture.get(id)!).map((b) => new THREE.Mesh(b.geometry, b.material));
const hit = (id: string, x: number, z: number, from: number) => new THREE.Raycaster(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes(id))[0]?.point.y;

describe("new furniture range", () => {
  it("adds eighteen distinct model kinds across seven useful categories, not colour variants", () => {
    expect(data.length).toBe(18);
    expect(new Set(data.map((i) => i.model.kind)).size).toBe(18);
    expect(new Set(data.map((i) => i.category))).toEqual(new Set(["living", "bedroom", "kitchen", "bathroom", "office", "entertainment", "outdoor"]));
    for (const raw of data) {
      const item = catalog.furniture.get(raw.id)!;
      expect(item.variantOf).toBeUndefined();
      expect(EXPANSION_BUILDERS[item.model.kind]).toBeTypeOf("function");
      expect(modelFor(item).length).toBeGreaterThan(2);
      expect(searchCatalog([...catalog.furniture.values()], item.tags![0]!)).toContain(item);
    }
  });
  it.each(["bedroom_bench", "ergonomic_chair", "hanging_egg_chair"])("%s puts every seat directly on its cushion", (id) => {
    const item = catalog.furniture.get(id)!;
    for (const interaction of item.interactions!) for (const s of interaction.slots) {
      const y = hit(id, s.pose[0] - item.footprint[0] / 2, s.pose[1] - item.footprint[1] / 2, s.y + .04);
      expect(y).toBeDefined(); expect(y).toBeCloseTo(s.y, 2);
    }
  });
  it("leaves two recessed basins in the double vanity", () => {
    for (const x of [-.5, .5]) {
      expect(hit("double_vanity", x, 0, .9)).toBeLessThan(.77);
      expect(hit("double_vanity", x, .23, .9)).toBeGreaterThan(.82);
    }
  });
  it("keeps the island prep and serving surface clear and at its declared height", () => {
    expect(hit("island_butcher", 0, 0, 2)).toBeCloseTo(.9, 2);
    expect(hit("island_butcher", -.5, .25, 2)).toBeCloseTo(.9, 2);
    expect(catalog.furniture.get("island_butcher")!.surface).toBe(true);
  });
  it("does not advertise unsupported washing-machine, arcade, music or foosball actions", () => {
    for (const id of ["laundry_washer", "arcade_cabinet", "vinyl_console", "foosball_table"])
      expect(catalog.furniture.get(id)!.interactions).toBeUndefined();
  });
});
