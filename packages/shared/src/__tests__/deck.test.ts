import { describe, expect, it } from "vitest";
import { emptyLife, type LifeState } from "../life/state";
import { applyParty, BUILD_BEATS, deckBeat, deckPump, DEFAULT_DECK, DROP_BEATS, pauseMusic, PartyCmd, restoredParty, savedParty, sectionAt, type PartyContext, type PartyRole } from "../party";

const T0 = 1_000_000;
const gear = (music = true): Record<PartyRole, boolean> => ({ lights: true, music, dance: false, speaker: true });
let n = 0;
const ctx = (now: number, music = true): PartyContext => ({ memberId: "m1", now, newId: () => `id${String(++n).padStart(8, "0")}`, gear: gear(music) });
const send = (s: LifeState, cmd: unknown, now: number, music = true) => applyParty(s, PartyCmd.parse(cmd), ctx(now, music));
const fresh = () => emptyLife() as LifeState;
/** At 120 bpm a beat is half a second. */
const BEAT = 500;

describe("the DJ deck", () => {
  it("needs a music player or a DJ booth", () => {
    const s = fresh();
    expect(send(s, { cmd: "deck", set: { playing: true } }, T0, false).reject).toBe("no-music");
    expect(send(s, { cmd: "drop" }, T0, false).reject).toBe("no-music");
  });

  it("refuses records it doesn't have and tempos out of range", () => {
    expect(PartyCmd.safeParse({ cmd: "deck", set: { a: "not-a-record" } }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "deck", set: { bpm: 200 } }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "deck", set: { xfade: 1.5 } }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "deck", set: { volume: 1 } }).success).toBe(false);
  });

  it("keeps the beat on the server clock, through pauses and tempo changes", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true } }, T0);
    const d = s.party!.deck!;
    expect(deckBeat(d, T0 + 4 * BEAT)).toBeCloseTo(4);
    send(s, { cmd: "deck", set: { playing: false } }, T0 + 4 * BEAT);
    expect(deckBeat(d, T0 + 100 * BEAT)).toBeCloseTo(4);
    send(s, { cmd: "deck", set: { playing: true } }, T0 + 10 * BEAT);
    expect(deckBeat(d, T0 + 12 * BEAT)).toBeCloseTo(6);
    // a faster tempo carries on from the same beat
    send(s, { cmd: "deck", set: { bpm: 140 } }, T0 + 12 * BEAT);
    expect(deckBeat(d, T0 + 12 * BEAT)).toBeCloseTo(6);
    expect(deckBeat(d, T0 + 12 * BEAT + 60_000 / 140)).toBeCloseTo(7);
  });

  it("reports no change for a setting already in place", () => {
    const s = fresh();
    expect(send(s, { cmd: "deck", set: { playing: true } }, T0).changed).toBe(true);
    expect(send(s, { cmd: "deck", set: { playing: true } }, T0 + 1000).changed).toBe(false);
    expect(send(s, { cmd: "deck", set: { xfade: 0 } }, T0 + 1000).changed).toBe(false);
    expect(send(s, { cmd: "deck", set: { xfade: 0.4, b: "night-bus", echo: true, filter: -0.5 } }, T0 + 1000).changed).toBe(true);
    expect(s.party!.deck).toMatchObject({ xfade: 0.4, b: "night-bus", echo: true, filter: -0.5 });
  });

  it("cues each recording independently and saves the cues with the paused playhead", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true } }, T0);
    send(s, { cmd: "deck", set: { a: "atlasaudio-edm" } }, T0 + 4 * BEAT);
    send(s, { cmd: "deck", set: { b: "kulakovka-hard-edm" } }, T0 + 8 * BEAT);
    expect(send(s, { cmd: "deck", set: { a: "atlasaudio-edm" } }, T0 + 9 * BEAT).changed).toBe(false);
    const saved = savedParty(s.party!, T0 + 10 * BEAT);
    const restored = restoredParty(JSON.parse(JSON.stringify(saved)))!;
    expect(restored.deck).toMatchObject({ a: "atlasaudio-edm", b: "kulakovka-hard-edm", cueA: 4, cueB: 8, beat: 10, playing: false });
    send(s, { cmd: "deck", set: { a: "night-bus" } }, T0 + 11 * BEAT);
    expect(s.party!.deck!.cueA).toBeUndefined();
  });

  it("takes turns with the YouTube music", () => {
    const s = fresh();
    send(s, { cmd: "add", videoId: "dQw4w9WgXcQ" }, T0);
    expect(s.party!.music.playing).toBe(true);
    send(s, { cmd: "deck", set: { playing: true } }, T0 + 5000);
    expect(s.party!.deck!.playing).toBe(true);
    expect(s.party!.music.playing).toBe(false);
    expect(s.party!.music.at).toBe(5000);
    send(s, { cmd: "play" }, T0 + 9000);
    expect(s.party!.music.playing).toBe(true);
    expect(s.party!.deck!.playing).toBe(false);
  });

  it("builds up on the next bar line and drops two bars later, one drop at a time", () => {
    const s = fresh();
    expect(send(s, { cmd: "drop" }, T0).changed).toBe(false); // not while it's stopped
    send(s, { cmd: "deck", set: { bpm: 120, playing: true } }, T0);
    expect(send(s, { cmd: "drop" }, T0 + 5 * BEAT).changed).toBe(true);
    const d = s.party!.deck!;
    expect(d.drop).toBe(8);
    expect(send(s, { cmd: "drop" }, T0 + 9 * BEAT).changed).toBe(false);
    expect(sectionAt(8, d.drop)).toBe("build");
    expect(sectionAt(8 + BUILD_BEATS, d.drop)).toBe("drop");
    expect(sectionAt(8 + BUILD_BEATS + DROP_BEATS, d.drop)).not.toBe("drop");
    // once it's over, another
    expect(send(s, { cmd: "drop" }, T0 + (8 + BUILD_BEATS + DROP_BEATS + 1) * BEAT).changed).toBe(true);
  });

  it("goes round a 32-bar phrase, and the speakers thump only while the kick plays", () => {
    expect([0, 32, 64, 96, 112].map((b) => sectionAt(b, null))).toEqual(["intro", "groove", "full", "break", "rise"]);
    expect(sectionAt(128, null)).toBe("intro");
    expect(deckPump(64, null)).toBeGreaterThan(0.7);
    expect(deckPump(64.9, null)).toBeLessThan(0.01);
    expect(deckPump(100, null)).toBe(0);
    expect(deckPump(0, 0)).toBe(0); // the build
    expect(deckPump(BUILD_BEATS, 0)).toBe(1); // the drop hits
  });

  it("is saved paused where it was, and older homes get a fresh deck", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true, a: "night-bus", xfade: 0.7 } }, T0);
    send(s, { cmd: "drop" }, T0 + BEAT);
    const saved = savedParty(s.party!, T0 + 10 * BEAT);
    expect(saved.deck).toMatchObject({ a: "night-bus", xfade: 0.7, playing: false, drop: null });
    expect(saved.deck!.beat).toBeCloseTo(10);
    expect(restoredParty(JSON.parse(JSON.stringify(saved)))!.deck).toEqual(saved.deck);
    const old = restoredParty({ lights: s.party!.lights, music: { queue: [], current: null, playing: false, at: 0 } });
    expect(old!.deck).toEqual(DEFAULT_DECK);
    expect(restoredParty({ ...saved, deck: { a: "junk", bpm: 9999, xfade: NaN } as never })!.deck).toMatchObject({ a: DEFAULT_DECK.a, bpm: 140, xfade: 0 });
  });

  it("holds when the house empties", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true } }, T0);
    expect(pauseMusic(s, T0 + 6 * BEAT)).toBe(true);
    expect(s.party!.deck).toMatchObject({ playing: false, beat: 6 });
    expect(pauseMusic(s, T0 + 9 * BEAT)).toBe(false);
  });
});
