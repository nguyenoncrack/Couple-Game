import { describe, expect, it } from "vitest";
import { emptyBlueprint, STOREY } from "../blueprint";
import { edgesBetween } from "../grid";
import { applyOp } from "../rules";
import { applyWorld, clockHour, clockLabel, coverAt, dayPhase, DAY_MOMENTS, DAY_MS, emptyWorld, FORCE_RAMP_MS, naturalRain, rainAt, RAMP_MS, restoredWorld, shelterMap, shiftFor, SPELL_MS, spellRain, sunHeight, underCover, wetAt } from "../world";

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

describe("the weather", () => {
  const spells = Array.from({ length: 400 }, (_, i) => i);

  it("rains in about half of the spells, for a minute or two, at any hour of the day or night", () => {
    const rainy = spells.filter((s) => spellRain(s));
    expect(rainy.length / spells.length).toBeGreaterThan(0.35);
    expect(rainy.length / spells.length).toBeLessThan(0.65);
    for (const s of rainy) {
      const r = spellRain(s)!;
      expect(r.end - r.start).toBeGreaterThanOrEqual(70_000);
      expect(r.end - r.start).toBeLessThanOrEqual(190_000);
      // inside its spell, with room for the ramps, so it never runs into the next spell's rain
      expect(r.start).toBeGreaterThanOrEqual(RAMP_MS);
      expect(r.end + RAMP_MS).toBeLessThanOrEqual(SPELL_MS);
    }
    // rain starts and stops in every part of the ten-minute day
    const phasesStarted = new Set<number>();
    for (const s of rainy) phasesStarted.add(Math.floor((((s * SPELL_MS + spellRain(s)!.start) % DAY_MS) / DAY_MS) * 4));
    expect(phasesStarted.size).toBe(4);
  });

  it("builds up and dies away smoothly, and is the same for everyone", () => {
    const s = spells.find((i) => spellRain(i))!;
    const r = spellRain(s)!;
    const at = (t: number) => naturalRain(s * SPELL_MS + t);
    expect(at(r.start - RAMP_MS - 1)).toBe(0);
    expect(at(r.start + (r.end - r.start) / 2)).toBeCloseTo(r.peak, 5);
    expect(at(r.end + RAMP_MS + 1)).toBe(0);
    let prev = at(0);
    for (let t = 100; t < SPELL_MS; t += 100) {
      const v = at(t);
      expect(Math.abs(v - prev)).toBeLessThan(0.02);
      prev = v;
    }
    expect(rainAt(123_456_789)).toBe(rainAt(123_456_789));
  });

  it("can be forced on or off, easing in from what it was, then handed back", () => {
    const dry = spells.find((i) => !spellRain(i))!;
    const t0 = dry * SPELL_MS + 100_000;
    const w = emptyWorld();
    expect(applyWorld(w, { cmd: "weather", set: "rain" }, t0)).toBe(true);
    expect(rainAt(t0, w)).toBeCloseTo(0, 5);
    expect(rainAt(t0 + FORCE_RAMP_MS / 2, w)).toBeGreaterThan(0.3);
    expect(rainAt(t0 + FORCE_RAMP_MS, w)).toBeCloseTo(1, 5);
    expect(rainAt(t0 + 9 * 60_000, w)).toBeCloseTo(1, 5);
    // forcing what's already forced changes nothing
    expect(applyWorld(w, { cmd: "weather", set: "rain" }, t0 + 5000)).toBe(false);
    expect(applyWorld(w, { cmd: "weather", set: "clear" }, t0 + 60_000)).toBe(true);
    expect(rainAt(t0 + 60_000 + FORCE_RAMP_MS, w)).toBeCloseTo(0, 5);
    expect(applyWorld(w, { cmd: "weather", set: "auto" }, t0 + 70_000)).toBe(true);
    expect(w.weather?.mode).toBe("auto");
    // handed back: it eases to the natural weather rather than jumping
    expect(rainAt(t0 + 70_000 + FORCE_RAMP_MS, w)).toBeCloseTo(naturalRain(t0 + 70_000 + FORCE_RAMP_MS), 5);
    expect(applyWorld(w, { cmd: "weather", set: "auto" }, t0 + 80_000)).toBe(false);
    // the weather never touches the day's clock
    expect(w.dayShift).toBe(0);
  });

  it("leaves puddles after the rain, drying out over a minute or two", () => {
    const w = emptyWorld();
    const t0 = 5_000_000;
    applyWorld(w, { cmd: "weather", set: "rain" }, t0);
    applyWorld(w, { cmd: "weather", set: "clear" }, t0 + 60_000);
    expect(wetAt(t0 + 60_000, w)).toBeGreaterThan(0.9);
    expect(wetAt(t0 + 60_000 + 45_000, w)).toBeGreaterThan(0.2);
    expect(wetAt(t0 + 60_000 + 45_000, w)).toBeLessThan(wetAt(t0 + 60_000 + 10_000, w));
    expect(wetAt(t0 + 60_000 + 100_000, w)).toBe(0);
    // (and nothing is wet that was never rained on)
    expect(wetAt(t0 - 500_000, emptyWorld())).toBeGreaterThanOrEqual(0);
  });

  it("keeps a forced weather only if it's sane", () => {
    expect(restoredWorld({ dayShift: 0, weather: { mode: "clear", at: 9, from: 5, wet: 0.5 } })?.weather).toEqual({ mode: "clear", at: 9, from: 1, wet: 0.5 });
    expect(restoredWorld({ dayShift: 0, weather: { mode: "auto", at: Number.NaN } })).toBeNull();
  });
});

describe("where it's dry", () => {
  const edges = (x1: number, z1: number, x2: number, z2: number) => edgesBetween(x1, z1, x2, z2);
  function room(roof: boolean) {
    let bp = emptyBlueprint(24, 20);
    const wall = (x1: number, z1: number, x2: number, z2: number) => {
      const r = applyOp(bp, { t: "walls.add", level: 0, edges: edges(x1, z1, x2, z2), style: "plaster_cream" }, undefined, { accepted: true });
      if (r.ok) bp = r.blueprint;
      else throw new Error(r.reason);
    };
    wall(4, 4, 10, 4);
    wall(10, 4, 10, 9);
    wall(10, 9, 4, 9);
    wall(4, 9, 4, 4);
    if (roof) {
      const cells = [];
      for (let x = 4; x < 10; x++) for (let z = 4; z < 9; z++) cells.push(`${x}:${z}`);
      const r = applyOp(bp, { t: "roof.paint", level: 0, cells, style: "roof_slate" }, undefined, { accepted: true });
      if (r.ok) bp = r.blueprint;
    }
    return bp;
  }

  it("keeps the rain out of a room shut in by walls, roof painted or not, and leaves the garden open", () => {
    for (const roof of [false, true]) {
      const map = shelterMap(room(roof));
      expect(coverAt(map, 6.5, 6.5)).toBeGreaterThanOrEqual(STOREY);
      expect(underCover(map, 6.5, 0, 6.5)).toBe(true);
      // the garden, the lawn beside the house, and anywhere off the lot: open sky
      expect(coverAt(map, 15.5, 6.5)).toBe(0);
      expect(coverAt(map, 6.5, 14.5)).toBe(0);
      expect(coverAt(map, -50, -50)).toBe(0);
      expect(underCover(map, 15.5, 0, 6.5)).toBe(false);
    }
  });

  it("covers a roofed porch that has no walls, and only up to the roof", () => {
    const bp = room(false);
    const r = applyOp(bp, { t: "roof.paint", level: 0, cells: ["15:6", "16:6"], style: "roof_slate" }, undefined, { accepted: true });
    if (!r.ok) throw new Error(r.reason);
    const map = shelterMap(r.blueprint);
    expect(coverAt(map, 15.5, 6.5)).toBeCloseTo(STOREY + 0.3, 5);
    expect(underCover(map, 15.5, 0, 6.5)).toBe(true);
    // standing on the roof (or higher) is not under cover
    expect(underCover(map, 15.5, STOREY + 0.4, 6.5)).toBe(false);
  });
});
