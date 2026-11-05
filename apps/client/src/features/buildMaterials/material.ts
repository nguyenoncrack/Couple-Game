import { catalog, type BuildSurface } from "@cg/shared";
import * as THREE from "three";
import { pencilMaterial } from "../../render/pencil";
import { buildSurfaceGlsl } from "./surfaceShader";

export type MaterialKind = "wall" | "floor";
const profiles: Record<BuildSurface, number> = { plaster: 1, panels: 2, brick: 3, stone: 4, tile: 5, concrete: 6, glass: 7, oak: 8, walnut: 9, parquet: 10, marble: 11, carpet: 12, decking: 13, pavers: 14 };
const gloss: Partial<Record<BuildSurface, [number, number]>> = { panels: [.12, 26], oak: [.15, 32], walnut: [.2, 40], parquet: [.2, 40], tile: [.35, 65], marble: [.42, 85], glass: [.7, 110], concrete: [.08, 24] };
const cache = new Map<string, THREE.ShaderMaterial>();

export function materialDefinition(kind: MaterialKind, id: string) {
  return kind === "wall" ? catalog.wallStyles.get(id) ?? catalog.wallStyles.get("plaster_cream")! : catalog.floorMaterials.get(id) ?? catalog.floorMaterials.get("oak")!;
}

export function buildingMaterial(kind: MaterialKind, id: string, ghost: "ok" | "bad" | null = null) {
  const definition = materialDefinition(kind, id), key = `${kind}:${definition.id}:${ghost ?? ""}`;
  let material = cache.get(key);
  if (material) return material;
  const fallback: Record<string, BuildSurface> = { wood: kind === "wall" ? "panels" : "oak", checker: "tile", carpet: "carpet", brick: "brick", stone: "stone", setts: "pavers", concrete: "concrete" };
  const surface = definition.surface ?? fallback[definition.finish] ?? "plaster";
  const glass = surface === "glass", [spec, shine] = gloss[surface] ?? [0, 1];
  const base = pencilMaterial(definition.color, { natural: true, rim: false, alpha: glass ? .24 : 1, ...(ghost ? { ghost } : {}) });
  const marker = "// @build-material-detail";
  if (!base.fragmentShader.includes(marker)) throw new Error("Building material shader hook is missing");
  material = new THREE.ShaderMaterial({
    vertexShader: base.vertexShader,
    fragmentShader: "uniform vec3 uJointTone;\n" + base.fragmentShader.replace(marker, buildSurfaceGlsl),
    // Keep shared sunlight, shadow, fog and wind uniform references; cloning would disconnect them.
    uniforms: { ...base.uniforms, uSpec: { value: spec }, uShine: { value: shine }, uJointTone: { value: new THREE.Color("#bbb9ac").convertLinearToSRGB() } },
    defines: { ...base.defines, BUILD_SURFACE: profiles[surface], BUILD_TILE_SIZE: kind === "wall" ? "0.3" : "0.5" },
    transparent: base.transparent, depthWrite: base.depthWrite, side: glass ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.forceSinglePass = true;
  material.userData.natural = true;
  material.userData.buildSurface = surface;
  material.userData.buildGlass = glass;
  cache.set(key, material);
  return material;
}
