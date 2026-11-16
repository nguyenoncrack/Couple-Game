import { DAY_MOMENTS } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { MIN_LIGHT_Y, skyAt, type RGB } from "./skyModel";

const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

describe("the sky through the day", () => {
  it("is bright by day, dark but readable by night", () => {
    const noon = skyAt(DAY_MOMENTS.noon);
    const midnight = skyAt(DAY_MOMENTS.midnight);
    expect(noon.day).toBeCloseTo(1, 2);
    expect(noon.night).toBeCloseTo(0, 2);
    expect(midnight.day).toBeCloseTo(0, 2);
    expect(midnight.night).toBeCloseTo(1, 2);
    // total ambient plus sun/moon: night is dimmer than day, but never black
    const total = (s: ReturnType<typeof skyAt>) => lum(s.sky) + lum(s.bounce) + lum(s.sun);
    expect(total(midnight)).toBeLessThan(total(noon) * 0.7);
    expect(total(midnight)).toBeGreaterThan(0.3);
    expect(lum(midnight.sky)).toBeGreaterThan(0.12);
  });

  it("changes smoothly: no frame jumps in light direction, colour or haze", () => {
    let prev = skyAt(0);
    for (let i = 1; i <= 2000; i++) {
      const s = skyAt(i / 2000);
      // (a step is 0.3 seconds of a ten-minute day)
      expect(Math.hypot(s.lightDir[0] - prev.lightDir[0], s.lightDir[1] - prev.lightDir[1], s.lightDir[2] - prev.lightDir[2])).toBeLessThan(0.02);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(s.sun[c]! - prev.sun[c]!)).toBeLessThan(0.02);
        expect(Math.abs(s.sky[c]! - prev.sky[c]!)).toBeLessThan(0.02);
        expect(Math.abs(hex(s.fog)[c]! - hex(prev.fog)[c]!)).toBeLessThan(5);
      }
      expect(Math.abs(s.night - prev.night)).toBeLessThan(0.03);
      prev = s;
    }
  });

  it("never lights the lot from below the shadow limit, and is the sun's by day and the moon's by night", () => {
    for (let i = 0; i < 400; i++) {
      const s = skyAt(i / 400);
      expect(s.lightDir[1]).toBeGreaterThanOrEqual(MIN_LIGHT_Y / 1.2);
      expect(Math.hypot(...s.lightDir)).toBeCloseTo(1, 6);
    }
    expect(skyAt(0.25).sunDir[1]).toBeGreaterThan(0.5);
    expect(skyAt(0.75).sunDir[1]).toBeLessThan(-0.5);
    expect(skyAt(0.75).moonDir[1]).toBeGreaterThan(0.5);
  });

  it("goes golden at sunrise and sunset, and lamps come on after dusk", () => {
    expect(skyAt(DAY_MOMENTS.sunset).gold).toBeGreaterThan(0.5);
    expect(skyAt(DAY_MOMENTS.noon).gold).toBeLessThan(0.05);
    expect(skyAt(DAY_MOMENTS.midnight).gold).toBeLessThan(0.05);
    expect(skyAt(0.25).night).toBe(0);
    expect(skyAt(0.55).night).toBeGreaterThan(0.6);
  });
});

import { overcast } from "./skyModel";

describe("rain cloud", () => {
  it("dims and greys the day, loses the golden hour, and leaves a clear sky alone", () => {
    const clear = skyAt(0.25);
    expect(overcast(clear, 0)).toBe(clear);
    const wet = overcast(clear, 1);
    expect(lum(wet.sun)).toBeLessThan(lum(clear.sun) * 0.4);
    expect(lum(wet.sky)).toBeLessThan(lum(clear.sky));
    // greyer: less spread between the colour channels
    const spread = (c: RGB) => Math.max(...c) - Math.min(...c);
    expect(spread(wet.sky)).toBeLessThan(spread(clear.sky));
    const dusk = skyAt(0.46);
    expect(overcast(dusk, 1).gold).toBeLessThan(dusk.gold * 0.3);
  });

  it("eases in with the rain, in small steps", () => {
    let prev = overcast(skyAt(0.25), 0);
    for (let r = 0.02; r <= 1.0001; r += 0.02) {
      const s = overcast(skyAt(0.25), r);
      expect(Math.abs(lum(s.sun) - lum(prev.sun))).toBeLessThan(0.05);
      prev = s;
    }
  });
});
