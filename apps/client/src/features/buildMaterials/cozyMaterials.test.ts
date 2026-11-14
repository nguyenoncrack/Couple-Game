import { catalog } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { buildingMaterial } from "./material";

describe("the cozy building materials", () => {
  it("draws framed frosted glass as milky glazing in frames, not clear glass and not an opaque wall", () => {
    const frosted = buildingMaterial("wall", "frosted_glass_framed");
    const clear = buildingMaterial("wall", "glass_framed");
    expect(frosted.userData.buildGlass).toBe(true);
    expect(frosted.userData.buildSurface).toBe("frosted");
    expect(frosted.transparent).toBe(true);
    // far less see-through than the clear glass, but still glazing (not fully solid)
    expect(frosted.uniforms.uAlpha!.value).toBeGreaterThan(clear.uniforms.uAlpha!.value * 2);
    expect(frosted.uniforms.uAlpha!.value).toBeLessThan(1);
    // after dark the glass glows with the light from inside
    expect(frosted.uniforms.uGlow!.value).toBeGreaterThan(0);
    expect(clear.uniforms.uGlow!.value).toBe(0);
  });

  it("draws cedar as boards and rain slate as flagstones, like the surfaces they share a pattern with", () => {
    const cedar = buildingMaterial("wall", "cedar_planks");
    const slate = buildingMaterial("floor", "slate_rain");
    expect(cedar.userData.buildSurface).toBe("shiplap");
    expect(slate.userData.buildSurface).toBe("slate");
    expect(cedar.userData.buildGlass).toBe(false);
    expect(cedar.defines!.BUILD_SURFACE).toBe(buildingMaterial("wall", "shiplap_white").defines!.BUILD_SURFACE);
    expect(catalog.wallStyles.get("cedar_planks")!.color).not.toBe(catalog.wallStyles.get("shiplap_white")!.color);
    // every wall and floor in the catalog still resolves to a drawable material
    for (const id of catalog.wallStyles.keys()) expect(buildingMaterial("wall", id).defines!.BUILD_SURFACE).toBeGreaterThan(0);
    for (const id of catalog.floorMaterials.keys()) expect(buildingMaterial("floor", id).defines!.BUILD_SURFACE).toBeGreaterThan(0);
  });
});
