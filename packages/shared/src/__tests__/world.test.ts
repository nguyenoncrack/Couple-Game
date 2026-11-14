import { describe, expect, it } from "vitest";
import { applyWorld, clockHour, clockLabel, dayPhase, DAY_MOMENTS, DAY_MS, emptyWorld, restoredWorld, shiftFor, sunHeight } from "../world";

describe("the world clock", () => {
  it("is a ten-minute day: five minutes of sun, five of night", () => {
    expect(DAY_MS).toBe(600_000);
    expect(sunHeight(dayPhase(0))).toBeCloseTo(0);
    // up for the first five minutes, down for the next five
    for (const sec of [10, 100, 200, 290]) expect(sunHeight(dayPhase(sec * 1000))).toBeGreaterThan(0);
    for (const sec of [310, 400, 500, 590]) expect(sunHeight(dayPhase(sec * 1000))).toBeLessThan(0);
    expect(dayPhase(DAY_MS * 7 + 123_456)).toBeCloseTo(dayPhase(123_456), 9);
  });

  it("depends only on the server time: any two readings of the same instant agree", () => {
    const now = 1_700_000_123_456;
    expect(dayPhase(now)).toBe(dayPhase(now));
    expect(dayPhase(now, { dayShift: 0 })).toBe(dayPhase(now, undefined));
  });

  it("jumps to named moments and then carries on from there", () => {
    const now = 1_700_000_000_000;
    for (const [name, phase] of Object.entries(DAY_MOMENTS)) {
      const w = emptyWorld();
      applyWorld(w, { cmd: "time", at: name as keyof typeof DAY_MOMENTS }, now);
      expect(dayPhase(now, w)).toBeCloseTo(phase, 9);
      // a minute later it's a tenth of a day on
      expect(dayPhase(now + 60_000, w)).toBeCloseTo((phase + 0.1) % 1, 9);
    }
    expect(shiftFor(0.25, 0.25 * DAY_MS)).toBe(0);
  });

  it("reads like a wall clock: 6 at sunrise, 12 at noon, 18 at sunset, 0 at midnight", () => {
    expect(clockHour(0)).toBe(6);
    expect(clockHour(0.25)).toBe(12);
    expect(clockHour(0.5)).toBe(18);
    expect(clockHour(0.75)).toBe(0);
    expect(clockLabel(0.25)).toBe("12:00 PM");
    expect(clockLabel(0.75)).toBe("12:00 AM");
    expect(clockLabel(0)).toBe("6:00 AM");
  });

  it("saves only a sane shift", () => {
    expect(restoredWorld(undefined)).toBeNull();
    expect(restoredWorld({ dayShift: Number.NaN })).toBeNull();
    expect(restoredWorld({ dayShift: DAY_MS * 3 + 5000 })?.dayShift).toBe(5000);
    expect(restoredWorld({ dayShift: -1000 })?.dayShift).toBe(DAY_MS - 1000);
    expect(restoredWorld({ dayShift: 0, weather: { mode: "rain", at: 5 } })).toEqual({ dayShift: 0, weather: { mode: "rain", at: 5 } });
    expect(restoredWorld({ dayShift: 0, weather: { mode: "hail", at: 5 } })).toBeNull();
  });
});
