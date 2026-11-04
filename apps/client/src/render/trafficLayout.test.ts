import { describe, expect, it } from "vitest";
import { STREET_REACH, streetZ } from "./sceneryLayout";
import { carAt, lanes } from "./trafficLayout";

describe("traffic on the street", () => {
  const d = 20;
  const all = lanes(d);

  it("keeps to two lanes either side of the middle line, going opposite ways", () => {
    expect(all.map((l) => l.dir).sort()).toEqual([-1, 1]);
    for (const l of all) {
      expect(Math.abs(l.z - streetZ(d))).toBeGreaterThan(1);
      expect(Math.abs(l.z - streetZ(d))).toBeLessThan(3.5);
      // keep right: heading +x is on the far (+z) side
      expect(Math.sign(l.z - streetZ(d))).toBe(l.dir);
    }
    expect(JSON.stringify(lanes(d))).toBe(JSON.stringify(all));
  });

  it("stays on the street, never bunches up, and comes by now and then", () => {
    const passes = [0, 0];
    for (let t = 0; t < 1200; t += 0.5) {
      all.forEach((lane, l) => {
        const xs = lane.cars.map((_, s) => carAt(lane, l, s, t)).filter((x): x is number => x !== null);
        for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(STREET_REACH + 0.01);
        xs.sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(20);
        // passing the house: crossing the middle in this half second
        for (let s = 0; s < lane.cars.length; s++) {
          const a = carAt(lane, l, s, t);
          const b = carAt(lane, l, s, t + 0.5);
          if (a !== null && b !== null && Math.sign(a) !== Math.sign(b)) passes[l]!++;
        }
      });
    }
    // twenty minutes: a car past the house every half minute or so in each lane, not a stream and not none
    for (const p of passes) {
      expect(p).toBeGreaterThan(15);
      expect(p).toBeLessThan(90);
    }
  });
});
