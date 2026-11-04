import { describe, expect, it } from "vitest";
import { campLayout, lakeShape } from "./sceneryLayout";
import { shoreLayout } from "./shoreLayout";
import { nearTrail, trailNetwork } from "./trailLayout";
import { woodsLayout } from "./woodsLayout";

describe.each([[24, 20], [30, 26]])("woods round a %i × %i lot", (w, d) => {
  const woods = woodsLayout(w, d);
  const lake = lakeShape(w);
  const camp = campLayout(d);
  const net = trailNetwork(w, d);
  const on = nearTrail(net);
  const shore = shoreLayout(w, d);
  const cx = w / 2;
  const cz = d / 2;
  const under = Object.values(woods.under).flat();
  const depth = (x: number, z: number) => Math.hypot(x - cx, z - cz) - woods.edge(Math.atan2(z - cz, x - cx));

  it("are bounded, and varied in kind and size", () => {
    expect(woods.trees.length).toBeLessThanOrEqual(700);
    expect(under.length).toBeLessThanOrEqual(700);
    expect(new Set(woods.trees.map((t) => t.kind)).size).toBe(6);
    const sizes = woods.trees.filter((t) => t.kind !== "sapling").map((t) => t.s * t.h);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
    for (const kind of Object.keys(woods.under) as (keyof typeof woods.under)[]) expect(woods.under[kind].length).toBeGreaterThan(0);
  });

  it("keep off the lot, the street, the campsite, the playground, the water, the trails and the clearings", () => {
    for (const { x, z } of [...woods.trees, ...under]) {
      expect(x > -2 && x < w + 2 && z > -2.5 && z < d + 1).toBe(false);
      expect(z > d + 0.5 && z < d + 13 && x > -32 && x < w + 32).toBe(false);
      expect(Math.abs(x - camp.cabin.x) < 3.6 && Math.abs(z - camp.cabin.z) < 3.6).toBe(false);
      expect(Math.hypot(x - camp.fire[0], z - camp.fire[2])).toBeGreaterThan(4.5);
      expect(x > w + 1 && x < w + 9.5 && Math.abs(z - (d / 2 + 0.5)) < 4.6).toBe(false);
      expect(lake.inside(x, z, 2)).toBe(false);
      expect(on(x, z, 0.9)).toBe(false);
      for (const c of [...net.open, ...shore.clearings]) expect(Math.hypot(c.x - x, c.z - z)).toBeGreaterThan(c.r);
    }
    for (const t of woods.trees) expect(on(t.x, t.z, 2)).toBe(false);
  });

  it("thicken gradually from meadow to forest, with a few lone trees and small things only within sight", () => {
    // trees in bands either side of the edge (metres from it; negative is out in the meadow)
    const band = (a: number, b: number) => woods.trees.filter((t) => depth(t.x, t.z) >= a && depth(t.x, t.z) < b).length;
    const meadow = band(-12, 0);
    expect(meadow).toBeGreaterThan(3);
    expect(meadow).toBeLessThan(30);
    expect(band(0, 10)).toBeGreaterThan(meadow * 2);
    expect(band(10, 25) / 15).toBeGreaterThan(band(0, 10) / 10);
    for (const t of under) expect(Math.hypot(t.x - cx, t.z - cz)).toBeLessThanOrEqual(46);
    // the understory hugs the edge rather than filling the meadow
    expect(under.filter((t) => depth(t.x, t.z) < -5).length).toBeLessThan(under.length * 0.1);
  });
});
