import { describe, expect, it } from "vitest";
import { emptyLevel } from "@cg/shared";
import { meadowClearance } from "./meadowLayout";
import { lakeShape } from "./sceneryLayout";
import { shoreLayout } from "./shoreLayout";
import { nearTrail, trailNetwork } from "./trailLayout";

describe.each([[24, 20], [30, 26]])("lake shore on a %i × %i lot", (w, d) => {
  const shore = shoreLayout(w, d);
  const lake = lakeShape(w);
  const net = trailNetwork(w, d);
  const on = nearTrail(net);

  it("is the same every time, with bounded counts", () => {
    const again = shoreLayout(w, d);
    expect(JSON.stringify(again)).toBe(JSON.stringify(shore));
    expect(shore.reeds.reduce((n, b) => n + b.count, 0)).toBeLessThanOrEqual(250);
    expect(shore.rocks.length + shore.pebbles.length + shore.lilies.length).toBeLessThanOrEqual(20);
  });

  it("varies the beach: wide by the jetty, almost none in the reeds", () => {
    expect(shore.beachWidth(1.45)).toBeGreaterThan(1.6);
    for (const bed of shore.reeds) expect(shore.beachWidth(bed.a)).toBeLessThan(0.3);
  });

  it("floats lilies on the water and keeps small detail to the near shore", () => {
    for (const l of shore.lilies) {
      // every pad, out to the cluster's edge and a pad's width beyond, is on the water
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) expect(lake.inside(l.x + Math.cos(a) * (l.r + 0.3), l.z + Math.sin(a) * (l.r + 0.3))).toBe(true);
      expect(l.z).toBeGreaterThan(lake.cz);
    }
    for (const p of shore.pebbles) {
      expect(lake.inside(p.x, p.z)).toBe(false);
      expect(p.z).toBeGreaterThan(lake.cz);
    }
  });

  it("puts the chairs on dry ground off the trail, facing the water, with stones from the trail to them", () => {
    const { x, z, facing, stones } = shore.seat;
    expect(lake.inside(x, z, 1)).toBe(false);
    expect(on(x, z, 1.8)).toBe(false);
    expect(lake.inside(x + Math.cos(facing) * 3, z + Math.sin(facing) * 3)).toBe(true);
    for (const c of net.open) expect(Math.hypot(c.x - x, c.z - z)).toBeGreaterThan(c.r + 1.5);
    for (const p of net.patches) expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThan(p.radius + 1.5);
    expect(stones.length).toBeGreaterThanOrEqual(2);
    expect(on(stones[0]![0], stones[0]![1], 1.3)).toBe(true);
    expect(Math.hypot(stones.at(-1)![0] - x, stones.at(-1)![1] - z)).toBeLessThan(1.9);
  });

  it("moors the boat in the water clear of the jetty, with the life ring beside the path", () => {
    const { boat, dock } = shore;
    expect(lake.inside(boat.x, boat.z, -1)).toBe(true);
    expect(Math.abs(boat.x - dock.x)).toBeGreaterThan(0.75 + 0.6);
    expect(on(dock.x - 0.98, dock.shoreZ + 0.75, 0.7)).toBe(false);
  });

  it("keeps meadow grass off the seating spot and pebble patches", () => {
    const clear = meadowClearance(w, d, emptyLevel());
    expect(clear(shore.seat.x, shore.seat.z)).toBe(false);
    for (const p of shore.pebbles) expect(clear(p.x, p.z)).toBe(false);
  });
});
