import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { catalog } from "@cg/shared";
import { Kit, type BuiltMesh } from "./kit";
import { modelFor, openingModelFor } from "./models";

const bodies = (meshes: BuiltMesh[]) => meshes.filter((m) => m.material.side !== THREE.BackSide);
function bounds(meshes: BuiltMesh[]) {
  const box = new THREE.Box3();
  for (const mesh of bodies(meshes)) {
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!);
  }
  return box;
}
function surface(id: string, x: number, z: number) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0));
  const meshes = bodies(modelFor(catalog.furniture.get(id)!)).map(({ geometry, material }) => new THREE.Mesh(geometry, material));
  return ray.intersectObjects(meshes, false)[0]?.point.y;
}
function valid(meshes: BuiltMesh[]) {
  expect(meshes.length).toBeGreaterThan(0);
  for (const { geometry } of meshes) {
    for (const name of ["position", "normal", "aCenter"]) {
      const attribute = geometry.getAttribute(name);
      expect(attribute, name).toBeDefined();
      expect(Array.from(attribute.array).every(Number.isFinite), name).toBe(true);
    }
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
  }
}

describe("catalog model geometry", () => {
  it.each(["soft", "roundbox"] as const)("%s includes its bevel in the requested dimensions", (shape) => {
    const kit = new Kit();
    kit.add(shape, new THREE.MeshBasicMaterial(), [0, 1, 0], [2, 0.4, 0.8]);
    const box = bounds(kit.build());
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(2, 5);
    expect(size.y).toBeCloseTo(0.4, 5);
    expect(size.z).toBeCloseTo(0.8, 5);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(1, 5);
    expect(center.z).toBeCloseTo(0, 5);
  });

  it.each([...catalog.furniture.values()])("$id has usable geometry and fits its footprint in all rotations", (item) => {
    const meshes = modelFor(item);
    valid(meshes);
    const box = bounds(meshes);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.00001);
    expect(box.min.y).toBeLessThanOrEqual(0.025);
    for (let turn = 0; turn < 4; turn++) {
      const rotated = box.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(turn * Math.PI / 2));
      const [width, depth] = turn % 2 ? [item.footprint[1], item.footprint[0]] : item.footprint;
      // The parasol intentionally shades neighboring cells; only its base occupies one cell.
      if (item.model.kind !== "parasol") {
        expect(rotated.min.x).toBeGreaterThanOrEqual(-width / 2 - 0.00001);
        expect(rotated.max.x).toBeLessThanOrEqual(width / 2 + 0.00001);
        expect(rotated.min.z).toBeGreaterThanOrEqual(-depth / 2 - 0.00001);
        expect(rotated.max.z).toBeLessThanOrEqual(depth / 2 + 0.00001);
      }
    }
    valid(modelFor(item, "ok"));
    valid(modelFor(item, "bad"));
  });

  it.each([...catalog.openings.values()])("$id builds full and cutaway wall variants", (item) => {
    for (const low of [null, 0, 0.8]) {
      for (const ghost of [null, "ok", "bad"] as const) valid(openingModelFor(item, ghost, low));
    }
  });

  it.each(["ping_pong_table", "blackjack_table"])("%s has a usable active model without the idle play props", (id) => {
    const item = catalog.furniture.get(id)!;
    const active = modelFor(item, null, true);
    valid(active);
    expect(bodies(active).reduce((n, mesh) => n + mesh.geometry.getAttribute("position").count, 0))
      .toBeLessThan(bodies(modelFor(item)).reduce((n, mesh) => n + mesh.geometry.getAttribute("position").count, 0));
  });

  it.each([
    ["bathtub", 0, 0, 0.49, 0.84],
    ["bath_sink", 0, -0.2, 0.83, 0.25],
    ["counter_sink", 0, -0.16, 0.77, 0.255],
    ["toilet", 0, -0.01, 0.36, 0.17],
  ] as const)("%s has a recessed basin rather than a solid cap", (id, x, z, floor, rimX) => {
    const inside = surface(id, x, z);
    const edge = surface(id, rimX, z);
    expect(inside).toBeDefined();
    expect(edge).toBeDefined();
    expect(inside!).toBeCloseTo(floor, 1);
    expect(edge! - inside!).toBeGreaterThan(0.04);
  });
});
