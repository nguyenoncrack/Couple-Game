import { describe, expect, it } from "vitest";
import { emptyLevel } from "@cg/shared";
import { meadowClearance } from "./meadowLayout";
import { campLayout, lakeShape } from "./sceneryLayout";
import { scenesLayout } from "./scenesLayout";
import { shoreLayout } from "./shoreLayout";
import { nearTrail, trailNetwork } from "./trailLayout";
import { woodsLayout } from "./woodsLayout";

describe.each([[24, 20], [30, 26]])("lived-in scenes round a %i × %i lot", (w, d) => {
  const s = scenesLayout(w, d);
  const lake = lakeShape(w);
  const { cabin, fire } = campLayout(d);
  const net = trailNetwork(w, d);
  const on = nearTrail(net);
  const shore = shoreLayout(w, d);
  // each thing, with roughly how far it reaches from where it stands
  const things = [
    { ...s.bicycle, r: 0.9 },
    { ...s.flowerBed, r: 0.95 },
    { ...s.wateringCan, r: 0.4 },
    { ...s.birdhouse, r: 0.3 },
    { ...s.woodpile, r: 1.1 },
    { ...s.picnic, r: 1.2 },
    ...s.lanterns.map((l) => ({ ...l, r: 0.45 })),
    { ...s.mailbox, r: 0.4 },
  ];

  it("is the same every time, with a bounded number of things", () => {
    expect(JSON.stringify(scenesLayout(w, d))).toBe(JSON.stringify(s));
    expect(things.length).toBeLessThanOrEqual(12);
  });

  it("keeps out of the lot, the street, the water and the trails", () => {
    for (const t of [...things, { ...s.ball, r: 0.2 }]) {
      // the lot and its fence (x and z within the fence line, which stops 0.2 short of the pavement's edge)
      expect(t.x > -0.6 - t.r && t.x < w + 0.6 + t.r && t.z > -0.6 - t.r && t.z < d + 0.2).toBe(false);
      expect(t.z + t.r * 0.5).toBeLessThan(d + 0.8); // short of the pavement
      expect(lake.inside(t.x, t.z, 0.5)).toBe(false);
    }
    for (const t of things) expect(on(t.x, t.z, t.r + 0.3)).toBe(false);
    // nothing in front of the cabin's door or on its porch, nor in the fire circle
    for (const t of things) {
      expect(t.x > cabin.x + 1.6 && t.x < cabin.x + 3.4 && Math.abs(t.z - cabin.z) < 2.4).toBe(false);
      expect(Math.hypot(t.x - fire[0], t.z - fire[2])).toBeGreaterThan(2.6);
    }
  });

  it("spreads a picnic on open grass above the water, clear of the shore's things", () => {
    const { x, z } = s.picnic;
    expect(on(x, z, 2)).toBe(false);
    expect(lake.inside(x, z, 1.6)).toBe(false);
    expect(Math.hypot(x - lake.cx, z - lake.cz)).toBeLessThan(lake.rx + 12);
    for (const c of [...shore.clearings, ...shore.rocks, ...net.open]) expect(Math.hypot(c.x - x, c.z - z)).toBeGreaterThan(c.r + 1.2);
    for (const p of net.patches) expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThan(p.radius + 1.2);
    // and the blanket faces the lake
    const toWater = Math.atan2(lake.cx - x, lake.cz - z);
    expect(Math.abs(Math.atan2(Math.sin(s.picnic.ry - toWater), Math.cos(s.picnic.ry - toWater)))).toBeLessThan(0.01);
  });

  it("keeps the meadow grass and the woods off the scenes", () => {
    const clear = meadowClearance(w, d, emptyLevel());
    for (const c of s.clearings) expect(clear(c.x, c.z)).toBe(false);
    const woods = woodsLayout(w, d);
    for (const t of [...woods.trees, ...Object.values(woods.under).flat()])
      for (const c of s.clearings) expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeGreaterThan(c.r + 0.8);
  });
});
