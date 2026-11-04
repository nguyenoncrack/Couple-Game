import { describe, expect, it } from "vitest";
import { ambientLayout, LEAF_DRIFT, MAX_BUTTERFLIES } from "./ambientLayout";
import { WIND } from "./pencil";
import { lakeShape } from "./sceneryLayout";

describe.each([[24, 20], [30, 26]])("small life round a %i × %i lot", (w, d) => {
  const a = ambientLayout(w, d);
  const lake = lakeShape(w);
  const inLot = (x: number, z: number) => x > -1 && x < w + 1 && z > -1 && z < d + 0.5;

  it("is the same every time, with bounded counts", () => {
    expect(JSON.stringify(ambientLayout(w, d))).toBe(JSON.stringify(a));
    expect(a.butterflies.length).toBeGreaterThan(3);
    expect(a.butterflies.length).toBeLessThanOrEqual(MAX_BUTTERFLIES);
    expect(a.flocks.reduce((n, f) => n + f.birds, 0)).toBeLessThanOrEqual(10);
    expect(a.leafTrees.length).toBeGreaterThan(4);
    expect(a.leafTrees.length).toBeLessThanOrEqual(14);
    expect(a.ripples.length).toBeGreaterThan(8);
    expect(a.ripples.length).toBeLessThanOrEqual(28);
  });

  it("keeps butterflies over the countryside's flowers, not the lot or the water", () => {
    for (const [x, z] of a.butterflies) {
      expect(inLot(x, z)).toBe(false);
      expect(lake.inside(x, z)).toBe(false);
    }
  });

  it("lets leaves fall outside the lot and onto dry ground", () => {
    for (const t of a.leafTrees) {
      // anywhere the twirl and the drift can carry a leaf
      for (const f of [0, 0.5, 1]) {
        const reach = t.spread + 0.4;
        const x = t.x + WIND[0] * LEAF_DRIFT * f;
        const z = t.z + WIND[1] * LEAF_DRIFT * f;
        expect(inLot(x - reach, z - reach) && inLot(x + reach, z + reach)).toBe(false);
        expect(inLot(x, z)).toBe(false);
      }
      expect(t.y).toBeGreaterThan(1.5);
    }
  });

  it("puts every ripple on the water and the birds well up in the sky", () => {
    for (const r of a.ripples) {
      expect(lake.inside(r.x, r.z)).toBe(true);
      expect(r.period).toBeGreaterThan(2);
      expect(r.phase).toBeGreaterThanOrEqual(0);
      expect(r.phase).toBeLessThan(1);
    }
    for (const f of a.flocks) expect(f.y).toBeGreaterThan(6);
  });
});
