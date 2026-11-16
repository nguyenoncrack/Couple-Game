import { DECK_TRACK_IDS, DEFAULT_DECK, type Section } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { musicPulse } from "../../../render/party/partyMaterials";
import { filterCutoffs, stepsDue, xfadeGains } from "./deckEngine";
import { recordingOffset, RECORDING_URLS } from "./recordings";
import { bassNote, chordVoicing, LAYERS, leadNote, TRACK_DEFS } from "./tracks";

describe("the deck's records", () => {
  it("maps every shared record to a whole-bar pattern or a bundled recording", () => {
    expect([...Object.keys(TRACK_DEFS), ...Object.keys(RECORDING_URLS)].sort()).toEqual([...DECK_TRACK_IDS].sort());
    for (const [id, def] of Object.entries(TRACK_DEFS)) {
      expect(def.id).toBe(id);
      for (const p of [def.kick, def.clap, def.hat, def.open, def.bass, def.lead]) expect(p).toMatch(/^[.xXrof0-7]{16}$/);
      expect(def.bars.length).toBeGreaterThan(0);
    }
  });

  it("keeps every note in a sensible range", () => {
    for (const def of Object.values(TRACK_DEFS)) {
      for (let bar = 0; bar < 4; bar++)
        for (let s = 0; s < 16; s++) {
          const b = bassNote(def, bar, s);
          if (b !== null) expect(b).toBeGreaterThanOrEqual(40), expect(b).toBeLessThanOrEqual(64);
          const l = leadNote(def, bar, s);
          if (l !== null) expect(l).toBeGreaterThanOrEqual(69), expect(l).toBeLessThanOrEqual(96);
        }
      for (let bar = 0; bar < 4; bar++) for (const n of chordVoicing(def, bar)) expect(n).toBeGreaterThanOrEqual(57), expect(n).toBeLessThan(69);
    }
  });

  it("drops the kick in a breakdown and a build, and brings everything in for the drop", () => {
    const all = Object.keys(LAYERS) as Section[];
    expect(all.filter((s) => LAYERS[s].kick === 0).sort()).toEqual(["break", "build"]);
    expect(Object.values(LAYERS.drop).every((v) => v >= 1)).toBe(true);
  });
});

describe("the deck's engine", () => {
  it("starts recordings at their cue and wraps at the end of the file", () => {
    expect(recordingOffset(20, 20, 120)).toBe(0);
    expect(recordingOffset(144, 20, 120)).toBe(60);
    expect(recordingOffset(330, 20, 120)).toBe(30);
  });

  it("schedules each sixteenth once, never one already gone", () => {
    expect(stepsDue(0, 10, 10.3)).toEqual([40, 42]);
    // the next tick picks up where the last left off
    expect(stepsDue(42, 10.2, 10.5)).toEqual([42, 42]);
    expect(stepsDue(42, 10.4, 10.7)).toEqual([42, 43]);
    // joining late: nothing from before now
    expect(stepsDue(0, 100.6, 100.9)[0]).toBe(403);
  });

  it("crossfades at equal power and maps the filter knob", () => {
    expect(xfadeGains(0)).toEqual([1, 0]);
    const [a, b] = xfadeGains(0.5);
    expect(a).toBeCloseTo(b);
    expect(a * a + b * b).toBeCloseTo(1);
    expect(filterCutoffs(0)).toEqual({ low: 20_000, high: 20 });
    expect(filterCutoffs(-1).low).toBeCloseTo(180);
    expect(filterCutoffs(1).high).toBeCloseTo(2_400);
  });

  it("moves the speakers with the deck's beat, or a steady beat for YouTube, and not at all in silence", () => {
    const deck = { ...DEFAULT_DECK, playing: true, bpm: 120, t: 0, beat: 64 };
    const onBeat = musicPulse(deck, undefined, 0);
    const between = musicPulse(deck, undefined, 400);
    expect(onBeat.pump).toBeGreaterThan(0.7);
    expect(between.pump).toBeLessThan(onBeat.pump);
    expect(onBeat.levels[1]).toBeCloseTo(0); // all deck A
    const video = musicPulse(undefined, { queue: [], current: { id: "t1", videoId: "aaaaaaaaaaa", by: "m" }, playing: true, at: 0 }, 1000);
    expect(video.playing).toBe(true);
    expect(video.pump).toBeGreaterThan(0.5);
    expect(musicPulse({ ...deck, playing: false }, undefined, 0)).toMatchObject({ playing: false, pump: 0 });
  });
});
