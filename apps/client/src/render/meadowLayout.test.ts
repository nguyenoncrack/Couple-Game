import { describe, expect, it } from "vitest";
import { applyOp, buildNav, catalog, emptyBlueprint, emptyLevel, type Blueprint, type Op } from "@cg/shared";
import { meadowClearance, meadowLayout } from "./meadowLayout";
import { campLayout, lakeShape } from "./sceneryLayout";

describe("cosmetic meadow", () => {
  it("stays deterministic and bounded, without editing the blueprint or navigation", () => {
    const bp = emptyBlueprint();
    const before = JSON.stringify(bp), nav = buildNav(bp);
    const meadow = meadowLayout(24, 20, bp.levels[0]!);
    expect(meadow).toEqual(meadowLayout(24, 20, bp.levels[0]!));
    expect(meadow.grass.length).toBeGreaterThan(700);
    expect(meadow.flowers.length).toBeGreaterThan(100);
    expect(meadow.grass.length + meadow.flowers.length).toBeLessThanOrEqual(2700);
    expect(JSON.stringify(bp)).toBe(before);
    expect(buildNav(bp)).toBe(nav);
    const lake = lakeShape(24), camp = campLayout(20);
    for (const s of [...meadow.grass, ...meadow.flowers]) {
      expect(lake.inside(s.x, s.z, 1.5)).toBe(false);
      expect(Math.hypot(s.x - camp.fire[0], s.z - camp.fire[2])).toBeGreaterThanOrEqual(3.85);
      expect(s.z > 20.5 && s.z < 32 && s.x > -31 && s.x < 55).toBe(false);
    }
  });

  it("clears complete plants around floors, roofs, rotated furniture and bare enclosed rooms", () => {
    const level = emptyLevel();
    level.tiles["5:5"] = { material: "oak" };
    level.roofs["7:5"] = { style: "clay" };
    level.objects.test = { id: "test", catalogId: "sofa_cozy", x: 10, z: 5, rot: 1 };
    for (let x = 14; x < 17; x++) for (const z of [4, 7]) level.walls[`h:${x}:${z}`] = { style: "cream" };
    for (let z = 4; z < 7; z++) for (const x of [14, 17]) level.walls[`v:${x}:${z}`] = { style: "cream" };
    const clear = meadowClearance(24, 20, level);
    for (const [x, z] of [[5.5, 5.5], [4.8, 5.5], [7.5, 5.5], [10.5, 6.8], [11.2, 6], [15.5, 5.5], [13.8, 5.5]]) expect(clear(x!, z!)).toBe(false);
    expect(clear(19.5, 5.5)).toBe(true);
  });

  it("removes only covered plants during construction and restores them after removal", () => {
    const level = emptyLevel(), original = meadowLayout(24, 20, level);
    const at = original.grass.find((s) => s.x > 2 && s.x < 22 && s.z > 2 && s.z < 17)!;
    expect(at).toBeDefined();
    const built = { ...level, tiles: { [`${Math.floor(at.x)}:${Math.floor(at.z)}`]: { material: "oak" } } };
    const changed = meadowLayout(24, 20, built);
    expect(changed.grass).not.toContainEqual(at);
    expect(changed.grass.every((s) => original.grass.some((p) => p.x === s.x && p.z === s.z))).toBe(true);
    expect(meadowLayout(24, 20, level)).toEqual(original);
  });

  it.each(["flowers_daisies", "flowers_tulips", "flowers_lavender"])("%s uses normal saved decoration placement, rotation, moving and removal", (catalogId) => {
    let bp: Blueprint = emptyBlueprint();
    const apply = (op: Op) => { const r = applyOp(bp, op); expect(r.ok).toBe(true); if (r.ok) bp = r.blueprint; };
    expect(catalog.furniture.get(catalogId)?.category).toBe("decor");
    apply({ t: "object.place", level: 0, id: "flower0001", catalogId, x: 5, z: 5, rot: 1 });
    expect(JSON.parse(JSON.stringify(bp)).levels[0].objects.flower0001.catalogId).toBe(catalogId);
    apply({ t: "object.move", level: 0, id: "flower0001", x: 8, z: 8, rot: 2 });
    apply({ t: "object.remove", level: 0, id: "flower0001" });
    expect(bp.levels[0]!.objects).toEqual({});
  });
});
