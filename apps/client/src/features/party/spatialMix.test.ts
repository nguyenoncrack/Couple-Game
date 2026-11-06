import { describe, expect, it } from "vitest";
import { easeGain, falloff, FLOOR, musicGain, NEAR, STOREY_AS_METRES, type Source } from "./spatialMix";

const speaker = (x: number, z: number, level = 0): Source => ({ x, z, level, loud: 1 });

describe("music that gets quieter the further you are from the speakers", () => {
  it("is full volume right next to a speaker", () => {
    expect(musicGain([speaker(5, 5)], 5, 5, 0)).toBe(1);
    expect(falloff(NEAR)).toBe(1);
  });

  it("falls steadily with distance and never quite reaches silence", () => {
    let last = 1;
    for (const m of [3, 5, 8, 12, 20, 60]) {
      const g = falloff(m);
      expect(g).toBeLessThan(last);
      expect(g).toBeGreaterThanOrEqual(FLOOR);
      last = g;
    }
    expect(falloff(1000)).toBe(FLOOR);
  });

  it("follows the nearest speaker", () => {
    const sources = [speaker(0, 0), speaker(20, 0)];
    expect(musicGain(sources, 19, 0, 0)).toBe(1);
    expect(musicGain(sources, 10, 0, 0)).toBeLessThan(0.2);
  });

  it("is quieter on another floor than right beside the speaker, and a booth is a little softer than a speaker", () => {
    expect(musicGain([speaker(5, 5)], 5, 5, 1)).toBeLessThan(0.3);
    expect(musicGain([{ x: 5, z: 5, level: 0, loud: 0.8 }], 5, 5, 0)).toBeCloseTo(0.8);
    expect(STOREY_AS_METRES).toBeGreaterThan(NEAR);
  });

  it("doesn't fade with no sources at all", () => {
    expect(musicGain([], 3, 3, 0)).toBe(1);
  });

  it("eases towards a target and settles on it", () => {
    let g = 1;
    for (let i = 0; i < 40; i++) g = easeGain(g, 0.2);
    expect(g).toBe(0.2);
    expect(easeGain(1, 0.2)).toBeLessThan(1);
    expect(easeGain(1, 0.2)).toBeGreaterThan(0.2);
  });
});
