import { describe, expect, it } from "vitest";
import { emptyLevel } from "@cg/shared";
import { meadowClearance } from "./meadowLayout";
import { campLayout, lakeShape } from "./sceneryLayout";
import { nearTrail, trailCurve, trailNetwork } from "./trailLayout";

const sample = (pts: [number, number][]) => trailCurve(pts).getSpacedPoints(200);

describe.each([[24, 20], [30, 26]])("countryside trails on a %i × %i lot", (w, d) => {
  const net = trailNetwork(w, d);
  const lake = lakeShape(w);
  const camp = campLayout(d);

  it("are the same every time", () => {
    expect(trailNetwork(w, d)).toEqual(net);
  });

  it("keep off the lot and its fence, the water, the cabin, the fire circle, the playground and the road", () => {
    for (const t of net.trails)
      for (const p of sample(t.points)) {
        expect(p.x > -1.3 && p.x < w + 1.3 && p.z > -1.3 && p.z < d + 0.5).toBe(false);
        expect(lake.inside(p.x, p.z, 0.4)).toBe(false);
        expect(Math.abs(p.x - camp.cabin.x) < 2.2 && Math.abs(p.z - camp.cabin.z) < 2.2).toBe(false);
        expect(Math.hypot(p.x - camp.fire[0], p.z - camp.fire[2])).toBeGreaterThan(3);
        // the bark is 7 × 7.4 round (w + 5, d / 2 + 0.5); trails may only touch its edge
        expect(Math.abs(p.x - (w + 5)) < 3.2 && Math.abs(p.z - (d / 2 + 0.5)) < 3.4).toBe(false);
        expect(p.z).toBeLessThan(d + 1.2);
      }
  });

  it("join up: the lake trail leaves the cabin porch and the others carry on from it", () => {
    const [lakeTrail, meadow, spur] = net.trails;
    const porch = camp.trails[1]!.at(-1)!;
    expect(lakeTrail!.points[0]).toEqual(porch);
    expect(lakeTrail!.points).toContainEqual(meadow!.points[0]);
    expect(spur!.points.at(-1)![1]).toBeGreaterThan(d + 0.5); // onto the pavement
  });

  it("leave signposts and flowers beside the path, never on it, and the clearings empty", () => {
    const on = nearTrail(net);
    for (const s of net.signs) {
      expect(on(s.x, s.z, 0.75)).toBe(false);
      expect(on(s.x, s.z, 2)).toBe(true);
    }
    expect(net.patches.length).toBeGreaterThanOrEqual(3);
    expect(net.patches.length).toBeLessThanOrEqual(10);
    expect(net.patches.reduce((n, p) => n + p.count, 0)).toBeLessThanOrEqual(200);
    for (const p of net.patches) {
      expect(on(p.x, p.z, 0.55 + p.radius * 0.6)).toBe(false);
      expect(lake.inside(p.x, p.z, 2.5)).toBe(false);
    }
    for (const c of net.open) {
      expect(on(c.x, c.z, Math.min(2, c.r))).toBe(false);
      for (const t of net.trails) for (const p of sample(t.points)) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(c.r);
      for (const p of net.patches) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(c.r);
    }
  });

  it("are kept clear of meadow grass", () => {
    const clear = meadowClearance(w, d, emptyLevel());
    for (const t of net.trails) for (const p of sample(t.points)) expect(clear(p.x, p.z)).toBe(false);
    for (const b of net.bare) expect(clear(b.x, b.z)).toBe(false);
  });
});
