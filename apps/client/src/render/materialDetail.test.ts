import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { catalog } from "@cg/shared";
import { Kit, timberUvs } from "./kit";
import { lighting, pencilMaterial, type Finish } from "./pencil";
import { modelFor } from "./models";

function faceUvRange(g: THREE.BufferGeometry, axis: number) {
  const n = g.getAttribute("normal"), uv = g.getAttribute("uv");
  const values: number[][] = [];
  for (let i = 0; i < n.count; i++) if ([n.getX(i), n.getY(i), n.getZ(i)][axis]! > 0.99) values.push([uv.getX(i), uv.getY(i)]);
  return [0, 1].map((j) => Math.max(...values.map((v) => v[j]!)) - Math.min(...values.map((v) => v[j]!)));
}

describe("material detail", () => {
  it("runs wood grain along a tabletop and along a leg at a consistent physical scale", () => {
    const top = new THREE.BoxGeometry().toNonIndexed(), leg = top.clone();
    timberUvs(top, new THREE.Matrix4().makeScale(2, 0.05, 0.8));
    timberUvs(leg, new THREE.Matrix4().makeScale(0.07, 0.9, 0.07));
    expect(faceUvRange(top, 1)[0]).toBeCloseTo(2);
    expect(faceUvRange(top, 1)[1]).toBeCloseTo(0.8);
    expect(faceUvRange(leg, 2)[0]).toBeCloseTo(0.9);
    expect(faceUvRange(leg, 2)[1]).toBeCloseTo(0.07);
    top.dispose(); leg.dispose();
  });

  it("does not slide grain when a component moves or turns", () => {
    const a = new THREE.BoxGeometry().toNonIndexed(), b = a.clone();
    const scale = new THREE.Vector3(2, 0.05, 0.8);
    timberUvs(a, new THREE.Matrix4().makeScale(...scale.toArray()));
    timberUvs(b, new THREE.Matrix4().compose(new THREE.Vector3(17, 2, -6), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.2, 0.1)), scale));
    expect(Array.from(b.getAttribute("uv").array)).toEqual(Array.from(a.getAttribute("uv").array));
    a.dispose(); b.dispose();
  });

  it("keeps pool and lake UVs intact while timber gets component grain coordinates", () => {
    const kit = new Kit();
    kit.box(pencilMaterial("#47c4d0", { finish: "water" }), [0, 0, 0], [6, 0.01, 3], { outline: false });
    const meshes = kit.build();
    const uv = meshes[0]!.geometry.getAttribute("uv");
    expect(Math.max(...Array.from(uv.array))).toBe(1);
    expect(Math.min(...Array.from(uv.array))).toBe(0);
    meshes.forEach((m) => m.geometry.dispose());
  });

  it("keeps shared finish profiles distinct without making duplicate material instances", () => {
    const finishes: Finish[] = ["wood", "timber", "fabric", "carpet", "ceramic", "mineral", "foliage", "paper", "rubber", "clay", "metal", "paint", "glass"];
    const mats = finishes.map((finish) => pencilMaterial("#c0a880", { finish }));
    expect(new Set(mats).size).toBe(finishes.length);
    finishes.forEach((finish, i) => expect(pencilMaterial("#c0a880", { finish })).toBe(mats[i]));
  });

  it("retains transparent ghosts and shared wind controls on textured surfaces", () => {
    const ghost = pencilMaterial("#8d9f6f", { finish: "foliage", sway: 0.1, ghost: "ok" });
    expect(ghost.transparent).toBe(true);
    expect(ghost.depthWrite).toBe(false);
    expect(ghost.uniforms.uAlpha!.value).toBeCloseTo(0.72);
    expect(ghost.uniforms.uWind).toBe(lighting.wind);
    expect(ghost.uniforms.uTime).toBe(lighting.time);
    expect(ghost.userData.sway).toBe(0.1);
  });

  it("preserves furniture wood colours supplied through reusable catalog data", () => {
    const item = catalog.furniture.get("coffee_table_oak")!;
    const meshes = modelFor({ ...item, id: "texture-custom-wood", model: { ...item.model, wood: "#624a38" } });
    const tone = new THREE.Color("#624a38").convertLinearToSRGB();
    expect(meshes.some((m) => m.material instanceof THREE.ShaderMaterial && m.material.userData.finish === "timber" && m.material.uniforms.uTone!.value.equals(tone))).toBe(true);
  });
});
