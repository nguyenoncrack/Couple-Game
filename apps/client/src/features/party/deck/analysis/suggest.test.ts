import { DEFAULT_BPM } from "@cg/shared";
import { describe, expect, it } from "vitest";
import type { Analysis } from "./analyze";
import { findLift, longestTogether, suggestMixes, tempoGap } from "./suggest";

/** A record's analysis with this energy (0 to 1) each second. */
function record(energy: (t: number) => number, seconds: number, bpm: number, reliable = true, downbeat = 0.2): Analysis {
  return {
    duration: seconds,
    peaks: new Uint8Array(0),
    lows: new Uint8Array(0),
    bpm,
    beat: downbeat,
    downbeat,
    confidence: reliable ? 0.9 : 0.1,
    reliable,
    energy: Uint8Array.from({ length: Math.ceil(seconds) }, (_, t) => Math.round(energy(t) * 255)),
  };
}
const beats = (s: number) => (s * DEFAULT_BPM) / 60;
const secs = (b: number) => (b * 60) / DEFAULT_BPM;

// a 4-minute record at 128: intro, a drop at 0:30, a breakdown at 2:00, an outro from 3:20
const song = (bpm = 128, reliable = true) =>
  record((t) => (t < 30 ? 0.35 : t < 120 ? 0.9 : t < 150 ? 0.4 : t < 200 ? 0.95 : 0.3), 240, bpm, reliable);

describe("suggested transitions", () => {
  it("finds where a record lifts", () => {
    expect(findLift(song())!.at).toBeGreaterThanOrEqual(28);
    expect(findLift(song())!.at).toBeLessThanOrEqual(32);
    expect(findLift(record(() => 0.5, 120, 128))).toBeNull();
  });

  it("tempo gaps allow for double time, and limit how long two records can mix", () => {
    expect(tempoGap(128, 64)).toBeCloseTo(0);
    expect(tempoGap(128, 130)).toBeCloseTo(0.0156, 3);
    expect(longestTogether(0)).toBe(16);
    expect(longestTogether(0.004)).toBe(16);
    expect(longestTogether(0.01)).toBe(8);
    expect(longestTogether(0.03)).toBe(2);
  });

  it("offers up to three, on the outgoing record's phrases, with the incoming drop landing as the mix ends", () => {
    const out = song();
    const inn = song();
    const s = suggestMixes({ out: "b", outPos: beats(10), bpm: 128, outA: out, inA: inn, inCues: [] });
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.length).toBeLessThanOrEqual(3);
    const phrase = (32 * 60) / 128;
    for (const x of s) {
      expect(x.out).toBe("b");
      expect(x.into).toBe("a");
      expect(x.approximate).toBe(false);
      // on a phrase of the outgoing record
      const k = (secs(x.at) - out.downbeat) / phrase;
      expect(Math.abs(k * 2 - Math.round(k * 2))).toBeLessThan(1e-3);
      // after now
      expect(secs(x.at)).toBeGreaterThan(10);
      // the incoming record comes in on one of its downbeats
      const bar = (4 * 60) / 128;
      const j = (secs(x.inAt) - inn.downbeat) / bar;
      expect(Math.abs(j - Math.round(j))).toBeLessThan(1e-3);
      expect(x.reason.length).toBeGreaterThan(10);
      expect(x.text).toMatch(/^At \d+:\d\d(\.\d)? on Deck B, bring in Deck A at \d+:\d\d(\.\d)? with an? \d+-bar /);
    }
    // the first is the next phrase, as a bass swap (same tempo); its incoming drop lands as it ends
    expect(s[0]!.style).toBe("bass");
    expect(s[0]!.bars).toBe(8);
    expect(secs(s[0]!.inAt) + secs(32)).toBeGreaterThan(26);
    expect(secs(s[0]!.inAt) + secs(32)).toBeLessThan(32);
    // one goes out at the breakdown, one at the outro
    expect(s.some((x) => Math.abs(secs(x.at) - 120) < 10)).toBe(true);
    expect(s.some((x) => secs(x.at) > 190)).toBe(true);
  });

  it("keeps it short when the tempos are apart", () => {
    const s = suggestMixes({ out: "a", outPos: 0, bpm: 124, outA: song(128), inA: song(140), inCues: [] });
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(x.bars).toBeLessThanOrEqual(2);
    expect(s[0]!.reason).toMatch(/128 vs 140 BPM/);
  });

  it("calls it approximate, a fade in seconds, without a steady beat", () => {
    const s = suggestMixes({ out: "a", outPos: 0, bpm: 124, outA: song(128, false), inA: song(), inCues: [] });
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) {
      expect(x.approximate).toBe(true);
      expect(x.style).toBe("blend");
      expect(x.text).toMatch(/^At about .* fade in Deck B from .* over about \d+ s\.$/);
    }
  });

  it("uses a saved cue on the incoming record for one of them", () => {
    const s = suggestMixes({ out: "b", outPos: 0, bpm: 128, outA: song(), inA: song(), inCues: [beats(72)] });
    expect(s.some((x) => Math.abs(x.inAt - beats(72)) < 0.01 && /saved cue/.test(x.reason))).toBe(true);
  });

  it("has nothing when the record on air is nearly over", () => {
    expect(suggestMixes({ out: "a", outPos: beats(236), bpm: 124, outA: song(), inA: song(), inCues: [] })).toEqual([]);
  });
});
