import { DEFAULT_DECK, type Deck } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { grooveOf, LightShow, SECTION_ENERGY, type Groove, type GrooveAnalysis } from "./lightShow";

const playing = (patch: Partial<Deck> = {}): Deck => ({ ...DEFAULT_DECK, a: "neon-drift", b: null, xfade: 0, playing: true, t: 0, beat: 0, cueA: 0, mix: null, drop: null, ...patch });
const none = () => null;
const groove = (patch: Partial<Groove> = {}): Groove => ({ beat: 0, barBeat: 0, bar: 0, energy: 0.8, section: "full", ...patch });

describe("what the music is doing", () => {
  it("is nothing while the deck is paused", () => {
    expect(grooveOf(playing({ playing: false }), 10, none)).toBeNull();
    expect(grooveOf(undefined, 10, none)).toBeNull();
  });

  it("follows a built-in record's sections and beats", () => {
    // bars 16–23 of a phrase are full, 24–27 a breakdown
    expect(grooveOf(playing(), 16 * 4 + 1.5, none)).toMatchObject({ section: "full", energy: SECTION_ENERGY.full, bar: 16, barBeat: 1.5 });
    expect(grooveOf(playing(), 25 * 4, none)).toMatchObject({ section: "break", energy: SECTION_ENERGY.break });
    // the Drop pad takes over
    expect(grooveOf(playing({ drop: 100 }), 110, none)?.section).toBe("drop");
  });

  it("lands on a listened-to recording's own beats and follows its loudness", () => {
    const energy = new Uint8Array(300).fill(40);
    energy.fill(250, 60, 120);
    const a: GrooveAnalysis = { bpm: 120, downbeat: 0.5, reliable: true, energy };
    const deck = playing({ a: "atlasaudio-edm" });
    // 124 track beats a minute: 62 beats in is 30 s in, 59 beats on its own 120 bpm grid from its downbeat at 0.5 s
    const quiet = grooveOf(deck, 62, () => a)!;
    expect(quiet.beat).toBeCloseTo(59);
    expect(quiet.energy).toBe(0);
    expect(grooveOf(deck, 124 * 1.5, () => a)!.energy).toBeGreaterThan(0.9);
    // not listened to yet: the deck's beat and a middling energy
    expect(grooveOf(deck, 62, none)).toMatchObject({ beat: 62, energy: 0.7 });
  });
});

describe("the light show", () => {
  it("flashes once a beat, hardest on the bar's first beat, and not in a breakdown", () => {
    const show = new LightShow();
    show.energy = 0.8;
    const at = (g: Partial<Groove>) => show.step(groove(g), 0.016, false).flash;
    expect(at({ beat: 8, barBeat: 0 })).toBeGreaterThan(0.6);
    expect(at({ beat: 9, barBeat: 1 })).toBeLessThan(at({ beat: 8, barBeat: 0 }));
    expect(at({ beat: 8.6, barBeat: 0.6 })).toBeLessThan(0.05);
    expect(at({ beat: 8, barBeat: 0, section: "break" })).toBe(0);
  });

  it("bursts once when the drop hits", () => {
    const show = new LightShow();
    show.step(groove({ section: "build", energy: 0.75 }), 0.016, false);
    expect(show.step(groove({ section: "drop", energy: 1 }), 0.016, false).lift).toBe(1);
    let lift = 1;
    // it fades over a second and a half, and doesn't fire again while the drop goes on
    for (let i = 0; i < 40; i++) lift = show.step(groove({ section: "drop", energy: 1 }), 0.05, false).lift;
    expect(lift).toBe(0);
  });

  it("bursts when a recording gets much louder fast", () => {
    const show = new LightShow();
    for (let i = 0; i < 100; i++) show.step(groove({ section: null, energy: 0.2 }), 0.05, false);
    expect(show.step(groove({ section: null, energy: 0.95 }), 0.05, false).lift).toBe(1);
  });

  it("holds calm and still in steady light", () => {
    const show = new LightShow();
    const frame = show.step(groove({ beat: 8, section: "drop", energy: 1 }), 0.016, true);
    expect(frame).toMatchObject({ flash: 0, lift: 0, bar: 0, barBeat: 0 });
  });
});
