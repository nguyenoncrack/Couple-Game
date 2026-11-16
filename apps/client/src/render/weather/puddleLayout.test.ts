import { applyOp, emptyBlueprint, shelterMap } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { gardenPuddles, MAX_PUDDLES, puddleSpots } from "./puddleLayout";

describe("puddles", () => {
  it("lie along the footpaths, the same on every screen, within the cap", () => {
    const a = puddleSpots(24, 20);
    expect(a.length).toBeGreaterThan(8);
    expect(a.length).toBeLessThanOrEqual(MAX_PUDDLES);
    expect(puddleSpots(24, 20)).toEqual(a);
    for (const p of a) {
      expect(Number.isFinite(p.x + p.z + p.angle)).toBe(true);
      expect(p.rx).toBeGreaterThan(0.2);
      expect(p.rx).toBeLessThan(1.6);
      expect(p.need).toBeGreaterThanOrEqual(0);
      expect(p.need).toBeLessThanOrEqual(0.8);
    }
  });

  it("gather on the paved paths you build, but not under a roof or inside a room", () => {
    let bp = emptyBlueprint(24, 20);
    const cells: string[] = [];
    for (let x = 2; x < 22; x++) for (let z = 14; z < 17; z++) cells.push(`${x}:${z}`);
    const paved = applyOp(bp, { t: "floor.paint", level: 0, cells, material: "stone" }, undefined, { accepted: true });
    if (!paved.ok) throw new Error(paved.reason);
    bp = paved.blueprint;
    const open = gardenPuddles(bp, shelterMap(bp), 50);
    expect(open.length).toBeGreaterThan(5);
    for (const p of open) {
      expect(p.z).toBeGreaterThanOrEqual(14);
      expect(p.z).toBeLessThan(17);
    }
    // roof the middle of the path: no puddles there any more
    const roofed = applyOp(bp, { t: "roof.paint", level: 0, cells: cells.filter((c) => Number(c.split(":")[0]) >= 8 && Number(c.split(":")[0]) < 16), style: "roof_slate" }, undefined, { accepted: true });
    if (!roofed.ok) throw new Error(roofed.reason);
    const under = gardenPuddles(roofed.blueprint, shelterMap(roofed.blueprint), 50);
    expect(under.length).toBeLessThan(open.length);
    for (const p of under) expect(p.x < 8 || p.x >= 16).toBe(true);
    // unpaved lots have none, and a zero room gives none
    expect(gardenPuddles(emptyBlueprint(24, 20), shelterMap(emptyBlueprint(24, 20)), 50)).toEqual([]);
    expect(gardenPuddles(bp, shelterMap(bp), 0)).toEqual([]);
  });
});
