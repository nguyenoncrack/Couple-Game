import { DEFAULT_BPM, trackBeats, type SetStep } from "@cg/shared";
import { describe, expect, it } from "vitest";
import type { Analysis } from "./analyze";
import { autoLink, linkAll, linkProblem } from "./chain";

const beats = (s: number) => (s * DEFAULT_BPM) / 60;

/** A 2:10 record at 126 with an intro, a drop at 0:30, a breakdown and an outro. */
function song(): Analysis {
  const seconds = 130;
  return {
    duration: seconds,
    peaks: new Uint8Array(0),
    lows: new Uint8Array(0),
    bpm: 126,
    beat: 0.1,
    downbeat: 0.1,
    confidence: 0.9,
    reliable: true,
    energy: Uint8Array.from({ length: seconds }, (_, t) => Math.round((t < 30 ? 0.35 : t < 70 ? 0.9 : t < 85 ? 0.4 : t < 110 ? 0.95 : 0.3) * 255)),
  };
}

describe("linking songs into a chain", () => {
  it("links late in the outgoing record, bringing the next one in for its drop", () => {
    const l = autoLink("atlasaudio-edm", 0, "take-me", 124, song(), song());
    expect(l.how).toBe("beats");
    expect(l.at).toBeGreaterThan(beats(90));
    expect(l.at).toBeLessThan(trackBeats("atlasaudio-edm"));
    expect(l.inFrom).toBeLessThan(beats(30));
  });

  it("falls back to a blend before the end without an analysis", () => {
    const l = autoLink("atlasaudio-edm", 0, "take-me", 124, null, null);
    expect(l).toMatchObject({ how: "fallback", style: "blend", bars: 8, inFrom: 0 });
    expect(l.at).toBeCloseTo(trackBeats("atlasaudio-edm") - 36, 2);
  });

  it("links every record to the next, and none after the last", () => {
    const steps: SetStep[] = ["atlasaudio-edm", "take-me", "back-to-u", "kulakovka-hard-edm"].map((track) => ({ track: track as SetStep["track"], from: 0, cues: [] }));
    const out = linkAll(steps, 124, () => song());
    expect(out.slice(0, 3).every((s) => s.next && s.next.at > s.from)).toBe(true);
    expect(out[3]!.next).toBeUndefined();
    for (let i = 0; i < 3; i++) expect(linkProblem(out[i]!, out[i]!.from)).toBeNull();
  });

  it("flags a link before its record gets there", () => {
    expect(linkProblem({ track: "take-me", from: 100, cues: [], next: { at: 50, style: "blend", bars: 4 } }, 100)).toMatch(/before/);
    expect(linkProblem({ track: "take-me", from: 0, cues: [], next: { at: 1e5, style: "blend", bars: 4 } }, 0)).toMatch(/end/);
  });
});
