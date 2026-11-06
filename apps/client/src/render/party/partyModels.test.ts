import { catalog } from "@cg/shared";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { modelFor } from "../models";
import { glowMaterial, platterMaterial, tileMaterial } from "./partyMaterials";
import { PARTY_KINDS } from "./partyModels";

const party = [...catalog.furniture.values()].filter((i) => i.category === "party");
const materials = (id: string, ghost: "ok" | "bad" | null = null, active = false) => new Set(modelFor(catalog.furniture.get(id)!, ghost, active).map((m) => m.material));
const triangles = (id: string, active = false) => modelFor(catalog.furniture.get(id)!, null, active).filter((m) => m.material.side !== THREE.BackSide).reduce((n, m) => n + m.geometry.getAttribute("position").count / 3, 0);

describe("party item models", () => {
  it("has a model of its own for every party item, and every model is used", () => {
    for (const kind of PARTY_KINDS) expect(party.some((i) => i.model.kind === kind), kind).toBe(true);
    for (const item of party) expect(PARTY_KINDS, item.id).toContain(item.model.kind);
  });

  it("paints dance floors, light strips and speakers with the party's shared materials, so they follow the lights", () => {
    expect(materials("dance_tile").has(tileMaterial)).toBe(true);
    expect(materials("dance_floor_2x2_white").has(tileMaterial)).toBe(true);
    expect(materials("led_strip").has(glowMaterial)).toBe(true);
    expect(materials("party_speaker").has(glowMaterial)).toBe(true);
    expect(materials("dj_booth").has(glowMaterial) && materials("dj_booth").has(platterMaterial)).toBe(true);
    expect(materials("laser_light").has(glowMaterial)).toBe(true);
  });

  it("is plain tinted material in a placement preview, so nothing glows through a wall", () => {
    for (const item of party) for (const ghost of ["ok", "bad"] as const) for (const m of materials(item.id, ghost)) expect([tileMaterial, glowMaterial, platterMaterial]).not.toContain(m);
  });

  it("leaves the moving parts out while the lights are on, because they're drawn live", () => {
    expect(triangles("moving_head", true)).toBeLessThan(triangles("moving_head"));
    expect(triangles("disco_ball", true)).toBeLessThan(triangles("disco_ball"));
    // the rest are the same either way
    expect(triangles("laser_light", true)).toBe(triangles("laser_light"));
    expect(triangles("dance_tile", true)).toBe(triangles("dance_tile"));
  });

  it("makes a floor of any size out of the same panel, one lit top to a cell", () => {
    const tops = (id: string) => modelFor(catalog.furniture.get(id)!).find((m) => m.material === tileMaterial)!.geometry.getAttribute("position").count / 36;
    expect(tops("dance_tile")).toBe(1);
    expect(tops("dance_floor_2x2")).toBe(4);
  });

  it("stands the DJ's places behind the decks and the audience's side in front", () => {
    const booth = catalog.furniture.get("dj_booth")!;
    const [w, d] = booth.footprint;
    expect([w, d]).toEqual([3, 1]);
    const slots = booth.interactions![0]!.slots;
    expect(slots[0]!.pose[1]).toBeLessThan(0);
    expect(slots[1]!.pose[1]).toBeLessThan(0);
    expect(slots[2]!.pose[1]).toBeGreaterThan(d);
  });
});
