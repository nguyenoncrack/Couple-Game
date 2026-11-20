import { DEFAULT_BPM, DEFAULT_DECK, FLAT_CHANNEL, type Deck } from "@cg/shared";
import { expect, it } from "vitest";
import { speakerMotion, speakerMotionAt, stepSpeakerMotion } from "./speakerMotion";

const noAnalysis = () => null;
const playing = (over: Partial<Deck> = {}): Deck => ({ ...DEFAULT_DECK, playing: true, beat: 64, ...over });

it("kicks on the beat, recoils between beats, and rests during a breakdown", () => {
  const at = (beat: number) => speakerMotionAt(playing({ beat }), undefined, 0, noAnalysis);
  expect(at(64).rock).toBeGreaterThan(0.8);
  expect(at(64.25).rock).toBeLessThan(0);
  expect(at(64.9).cone).toBeLessThan(0.01);
  expect(at(64.25)).toMatchObject({ phase: 0.25, strength: expect.any(Number) });
  expect(at(100)).toEqual({ cone: 0, rock: 0, phase: 0, strength: 0 });
});

it("uses the audible deck's recording grid when the favored deck is held", () => {
  const deck = playing({ beat: DEFAULT_BPM / 120, xfade: 0.25, holdA: 0, b: "atlasaudio-edm" });
  const analysis = () => ({ bpm: 120, downbeat: 0.5, reliable: true, energy: new Uint8Array([255]) });
  expect(speakerMotionAt(deck, undefined, 0, analysis).cone).toBeCloseTo(Math.sin(Math.PI / 8));
  expect(speakerMotionAt({ ...deck, chB: { ...FLAT_CHANNEL, vol: 0 } }, undefined, 0, analysis).cone).toBe(0);
});

it("settles after playback pauses and stays still with reduced motion", () => {
  try {
    stepSpeakerMotion(playing(), undefined, 0, 0.016, false, noAnalysis);
    const active = speakerMotion.cone;
    expect(active).toBeGreaterThan(0.1);
    stepSpeakerMotion(DEFAULT_DECK, undefined, 16, 0.016, false, noAnalysis);
    expect(speakerMotion.cone).toBeGreaterThan(0);
    expect(speakerMotion.cone).toBeLessThan(active);
    expect(speakerMotion.strength).toBe(0);
    stepSpeakerMotion(playing(), undefined, 32, 0.016, true, noAnalysis);
    expect(speakerMotion).toEqual({ cone: 0, rock: 0, phase: 0, strength: 0 });
  } finally {
    stepSpeakerMotion(undefined, undefined, 0, 0, true, noAnalysis);
  }
});
