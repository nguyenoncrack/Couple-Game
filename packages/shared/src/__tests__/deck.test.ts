import { describe, expect, it } from "vitest";
import { emptyLife, type LifeState } from "../life/state";
import { applyParty, BUILD_BEATS, cueFor, deckBeat, deckPump, deckRunning, DEFAULT_BPM, DEFAULT_DECK, DROP_BEATS, mixAt, pauseMusic, PartyCmd, placeIn, restoredDeck, restoredParty, savedParty, sectionAt, sectionOf, trackBeats, trackPosition, type Deck, type PartyContext, type PartyRole } from "../party";

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
    // a built-in record is cued too, from the bar it was loaded in
    send(s, { cmd: "deck", set: { a: "night-bus" } }, T0 + 11 * BEAT);
    expect(s.party!.deck!.cueA).toBe(8);
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

describe("transitions", () => {
  /** A deck playing at 120 bpm from T0, on deck A, with a record on B. */
  const playing = () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true } }, T0);
    return { s, d: s.party!.deck! };
  };

  it("start on the next bar line and take the crossfader over to the other deck", () => {
    const { s, d } = playing();
    expect(send(s, { cmd: "mix", style: "blend", bars: 2 }, T0 + 1.5 * BEAT).changed).toBe(true);
    expect(d.mix).toMatchObject({ style: "blend", from: 0, to: 1, start: 4, beats: 8 });
    expect(mixAt(d, 2).xfade).toBe(0);
    expect(mixAt(d, 8).xfade).toBeCloseTo(0.5);
    expect(mixAt(d, 8).progress).toBeCloseTo(0.5);
    expect(mixAt(d, 12)).toMatchObject({ xfade: 1, progress: null });
    // one at a time
    expect(send(s, { cmd: "mix", style: "cut", bars: 1 }, T0 + 6 * BEAT).changed).toBe(false);
    // the next command after it ends puts it away, and the next mix goes back the other way
    send(s, { cmd: "deck", set: { echo: true } }, T0 + 13 * BEAT);
    expect(d).toMatchObject({ xfade: 1, mix: null });
    send(s, { cmd: "mix", style: "cut", bars: 1 }, T0 + 13 * BEAT);
    expect(d.mix).toMatchObject({ from: 1, to: 0, start: 16, beats: 4 });
  });

  it("each have a sound of their own", () => {
    const d = { ...DEFAULT_DECK, mix: null } as Deck;
    const at = (style: "blend" | "bass" | "echo" | "filter" | "cut", beat: number) => mixAt({ ...d, mix: { style, from: 0, to: 1, start: 0, beats: 16 } }, beat);
    // a cut waits for the end and then switches
    expect(at("cut", 15.9).xfade).toBe(0);
    expect(at("cut", 16).xfade).toBe(1);
    // a bass swap: only one bass line at a time, the new one's held back until halfway
    expect(at("bass", 4).fx.b.low).toBe(-1);
    expect(at("bass", 4).fx.a.low).toBe(0);
    expect(at("bass", 12).fx.a.low).toBe(-1);
    expect(at("bass", 12).fx.b.low).toBe(0);
    // echo out sends the old deck into the echo
    expect(at("echo", 4).fx.a.echo).toBe(1);
    expect(at("echo", 4).fx.b.echo).toBe(0);
    // filter out thins the old deck first, and the new one only comes up late
    expect(at("filter", 8).fx.a.low).toBeLessThan(-0.7);
    expect(at("filter", 8).xfade).toBe(0);
    expect(at("filter", 14).xfade).toBeGreaterThan(0.5);
  });

  it("stop when a hand takes the crossfader, and need music playing and a record to go to", () => {
    const { s, d } = playing();
    send(s, { cmd: "mix", style: "blend", bars: 4 }, T0);
    send(s, { cmd: "deck", set: { xfade: 0.3 } }, T0 + 4 * BEAT);
    expect(d).toMatchObject({ xfade: 0.3, mix: null });
    send(s, { cmd: "deck", set: { b: null } }, T0 + 5 * BEAT);
    expect(send(s, { cmd: "mix", style: "blend", bars: 4 }, T0 + 5 * BEAT).changed).toBe(false);
    send(s, { cmd: "deck", set: { b: "night-bus", playing: false } }, T0 + 6 * BEAT);
    expect(send(s, { cmd: "mix", style: "blend", bars: 4 }, T0 + 6 * BEAT).changed).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "mix", style: "blend", bars: 3 }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "mix", style: "spin", bars: 4 }).success).toBe(false);
  });

  it("carry on from where they were when a saved deck comes back, and a finished one is put away", () => {
    const mix = { style: "blend", from: 0, to: 1, start: 0, beats: 16 } as const;
    const d = restoredDeck({ ...DEFAULT_DECK, xfade: 0, beat: 6, mix });
    expect(d.mix).toEqual(mix);
    expect(mixAt(d, 6).xfade).toBeGreaterThan(0);
    const done = restoredDeck({ ...DEFAULT_DECK, xfade: 0.4, beat: 20, mix });
    expect(done.xfade).toBe(1);
    expect(done.mix).toBeUndefined();
  });
});

describe("saved drop cues", () => {
  it("keeps each deck's cue through a save, then brings that deck on air at the marked position", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { b: "hard-summer-2017-live", chB: { vol: 0.6 } } }, T0);
    const cue = { cmd: "drop-cue", side: "b", track: "hard-summer-2017-live" };
    send(s, { ...cue, pos: 6250 }, T0);
    const deck = restoredParty(savedParty(s.party!, T0))!.deck!;
    expect(deck).toMatchObject({ dropCueB: 6250, playing: false, chB: { vol: 0.6 } });
    s.party!.deck = deck;
    send(s, cue, T0 + 500);
    expect(deck).toMatchObject({ xfade: 1, playing: true, mix: null });
    expect(trackPosition(deck, "b", deckBeat(deck, T0 + 500))).toBeCloseTo(6250);
    expect(trackPosition(deck, "a", deckBeat(deck, T0 + 500))).toBe(0);
    send(s, { cmd: "deck", set: { b: "take-me" } }, T0 + 800);
    expect(deck.dropCueB).toBeUndefined();
    expect(send(s, cue, T0 + 800).changed).toBe(false);
    expect(send(s, { cmd: "cue", side: "b", track: "hard-summer-2017-live", pos: 10 }, T0 + 800).changed).toBe(false);
  });

  it("hands playback to the remaining track and pauses when the last one is removed", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { playing: true, xfade: 0.6 } }, T0);
    send(s, { cmd: "mix", style: "blend", bars: 4 }, T0);
    send(s, { cmd: "deck", set: { b: null } }, T0 + 100);
    expect(s.party!.deck).toMatchObject({ xfade: 0, playing: true, mix: null, b: null });
    send(s, { cmd: "deck", set: { a: null } }, T0 + 200);
    expect(s.party!.deck).toMatchObject({ a: null, b: null, playing: false });
  });
});

describe("records on the decks", () => {
  it("can be taken off, so one record plays on its own", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { b: null } }, T0);
    const d = s.party!.deck!;
    expect(d.b).toBeNull();
    expect(d.cueB).toBeUndefined();
    expect(trackPosition(d, "b", 10)).toBeNull();
    // and stay off through a save
    expect(restoredDeck(JSON.parse(JSON.stringify(d))).b).toBeNull();
  });

  it("start from the beginning when loaded, a built-in one on the bar line", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true } }, T0);
    send(s, { cmd: "deck", set: { a: "night-bus", b: "back-to-u" } }, T0 + 9.5 * BEAT);
    const d = s.party!.deck!;
    expect(d.cueA).toBe(8);
    expect(d.cueB).toBeCloseTo(9.5);
    expect(trackPosition(d, "a", 9.5)).toBeCloseTo(1.5);
    expect(trackPosition(d, "b", 9.5)).toBeCloseTo(0);
  });

  it("jump to another part: a recording to the moment, a built-in record to the bar", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { bpm: 120, playing: true, a: "night-bus", b: "take-me" } }, T0);
    const d = s.party!.deck!;
    const at = 40;
    // a minute into the recording (in its own time, at the default tempo)
    const minute = DEFAULT_BPM;
    send(s, { cmd: "cue", side: "b", pos: minute }, T0 + at * BEAT);
    expect(trackPosition(d, "b", at)).toBeCloseTo(minute);
    // the built-in record goes to bar 17 (the "full" part), keeping in step with the deck's bars
    send(s, { cmd: "cue", side: "a", pos: 64 }, T0 + at * BEAT);
    expect(trackPosition(d, "a", at)).toBe(64);
    expect(Math.abs(d.cueA! % 4)).toBe(0);
    expect(sectionOf(trackPosition(d, "a", at)!, at, null)).toBe("full");
    // past the end is the end
    expect(cueFor("take-me", 100, 1e6)).toBeCloseTo(100 - (trackBeats("take-me") - 0.01));
    // a deck with nothing on it has nowhere to go
    send(s, { cmd: "deck", set: { a: null } }, T0 + at * BEAT);
    expect(send(s, { cmd: "cue", side: "a", pos: 4 }, T0 + at * BEAT).changed).toBe(false);
  });

  it("know how long they are", () => {
    expect(trackBeats("night-bus")).toBe(128);
    // Take Me is 3:12
    expect((trackBeats("take-me") * 60) / DEFAULT_BPM).toBeCloseTo(192.05);
  });

  it("let a drop take over a built-in record's own section", () => {
    expect(sectionOf(64, 10, null)).toBe("full");
    expect(sectionOf(64, 10, 8)).toBe("build");
    expect(sectionAt(64, null)).toBe("full");
  });
});

describe("deck channels", () => {
  it("keep each deck's volume and EQ, changed a knob at a time", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { chA: { low: -1 } } }, T0);
    send(s, { cmd: "deck", set: { chA: { vol: 0.5 }, chB: { high: 0.4 } } }, T0);
    const d = s.party!.deck!;
    expect(d.chA).toEqual({ vol: 0.5, low: -1, mid: 0, high: 0 });
    expect(d.chB).toEqual({ vol: 1, low: 0, mid: 0, high: 0.4 });
    expect(PartyCmd.safeParse({ cmd: "deck", set: { chA: { low: -2 } } }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "deck", set: { chA: { bass: 1 } } }).success).toBe(false);
    expect(restoredDeck(JSON.parse(JSON.stringify(d))).chA).toEqual(d.chA);
  });
});

/** Seconds into a record, in track beats. */
const sec = (s: number) => (s * DEFAULT_BPM) / 60;
const posOf = (d: Deck, side: "a" | "b", now: number) => trackPosition(d, side, deckBeat(d, now))!;
/** Real time for some track beats at the default tempo (ms). */
const msFor = (beats: number) => (beats * 60_000) / DEFAULT_BPM;

describe("each deck's own transport", () => {
  it("pauses one deck while the other plays on, and carries on from the same place", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "back-to-u", b: "take-me", playing: true } }, T0);
    const d = s.party!.deck!;
    send(s, { cmd: "transport", side: "b", playing: false }, T0 + 10_000);
    expect(posOf(d, "b", T0 + 40_000)).toBeCloseTo(sec(10), 1);
    expect(posOf(d, "a", T0 + 40_000)).toBeCloseTo(sec(40), 1);
    expect(deckRunning(d, "b", deckBeat(d, T0 + 40_000))).toBe(false);
    // jumping a paused deck moves where it waits
    send(s, { cmd: "cue", side: "b", pos: sec(84.5) }, T0 + 40_000);
    expect(posOf(d, "b", T0 + 50_000)).toBeCloseTo(sec(84.5), 2);
    send(s, { cmd: "transport", side: "b", playing: true }, T0 + 50_000);
    expect(posOf(d, "b", T0 + 52_000)).toBeCloseTo(sec(86.5), 1);
  });

  it("plays only that deck when the music was paused", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "back-to-u", b: "take-me" } }, T0);
    const d = s.party!.deck!;
    send(s, { cmd: "transport", side: "a", playing: true }, T0);
    expect(d.playing).toBe(true);
    expect(posOf(d, "a", T0 + 5000)).toBeCloseTo(sec(5), 1);
    expect(posOf(d, "b", T0 + 5000)).toBe(0);
  });

  it("keeps saved cue points on each record, through a save", () => {
    const s = fresh();
    send(s, { cmd: "mark", track: "take-me", pos: sec(84.5) }, T0);
    send(s, { cmd: "mark", track: "take-me", pos: sec(12) }, T0);
    expect(send(s, { cmd: "mark", track: "take-me", pos: sec(12) }, T0).changed).toBe(false);
    const d = restoredParty(savedParty(s.party!, T0))!.deck!;
    expect(d.marks?.["take-me"]).toEqual([placeIn("take-me", sec(12)), placeIn("take-me", sec(84.5))]);
    for (let i = 0; i < 10; i++) send(s, { cmd: "mark", track: "take-me", pos: sec(20 + i) }, T0);
    expect(s.party!.deck!.marks?.["take-me"]).toHaveLength(8);
    send(s, { cmd: "mark", track: "take-me", pos: sec(12), remove: true }, T0);
    expect(s.party!.deck!.marks?.["take-me"]).toHaveLength(7);
  });
});

describe("timed transitions", () => {
  /** B on air at 2:40, A loaded: "at 2:45 on B, start A at 1:12 and do an 8-bar bass swap". */
  function onB() {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "take-me", b: "back-to-u", xfade: 1 } }, T0);
    send(s, { cmd: "cue", side: "b", pos: sec(160) }, T0);
    send(s, { cmd: "deck", set: { playing: true } }, T0);
    send(s, { cmd: "mix", style: "bass", bars: 8, at: sec(165), inAt: sec(72) }, T0);
    return { s, d: s.party!.deck! };
  }

  it("waits for the moment on the record on air, with the incoming record parked at its cue", () => {
    const { d } = onB();
    expect(d.mix).toMatchObject({ style: "bass", to: 0, beats: 32 });
    expect(posOf(d, "a", T0 + 4000)).toBeCloseTo(sec(72), 2);
    expect(deckRunning(d, "a", deckBeat(d, T0 + 4000))).toBe(false);
    expect(mixAt(d, deckBeat(d, T0 + 4000))).toMatchObject({ xfade: 1, progress: null });
    // the mix starts as B reaches 2:45, with A coming in from 1:12
    expect(d.mix!.start).toBeCloseTo(deckBeat(d, T0 + 5000), 2);
    expect(posOf(d, "a", T0 + 5000 + msFor(4))).toBeCloseTo(sec(72) + 4, 2);
    expect(deckRunning(d, "a", deckBeat(d, T0 + 6000))).toBe(true);
    // a bass swap: the new bass is out until halfway, then the old one goes
    const k = (t: number) => mixAt(d, d.mix!.start! + t);
    expect(k(4).fx.a.low).toBe(-1);
    expect(k(20).fx.b.low).toBe(-1);
    expect(k(32).xfade).toBe(0);
  });

  it("goes the other way too: at 2:45 on A, start B at 1:12", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "back-to-u", b: "take-me", xfade: 0 } }, T0);
    send(s, { cmd: "cue", side: "a", pos: sec(160) }, T0);
    send(s, { cmd: "deck", set: { playing: true } }, T0);
    send(s, { cmd: "mix", style: "bass", bars: 8, at: sec(165), inAt: sec(72) }, T0);
    const d = s.party!.deck!;
    expect(d.mix).toMatchObject({ to: 1 });
    expect(posOf(d, "b", T0 + 4000)).toBeCloseTo(sec(72), 2);
    expect(d.mix!.start).toBeCloseTo(deckBeat(d, T0 + 5000), 2);
    expect(posOf(d, "b", T0 + 7000)).toBeCloseTo(sec(74), 1);
    send(s, { cmd: "setstep" }, T0 + 5000 + msFor(33));
    expect(d).toMatchObject({ mix: null, xfade: 1 });
  });

  it("freezes with the music mid-mix, and carries on from the same point", () => {
    const { s, d } = onB();
    const mid = T0 + 5000 + msFor(12);
    send(s, { cmd: "deck", set: { playing: false } }, mid);
    const frozen = mixAt(d, deckBeat(d, mid));
    expect(mixAt(d, deckBeat(d, mid + 60_000))).toEqual(frozen);
    expect(posOf(d, "a", mid + 60_000)).toBeCloseTo(sec(72) + 12, 2);
    expect(posOf(d, "b", mid + 60_000)).toBeCloseTo(sec(165) + 12, 2);
    send(s, { cmd: "deck", set: { playing: true } }, mid + 60_000);
    expect(mixAt(d, deckBeat(d, mid + 60_000))).toEqual(frozen);
    expect(posOf(d, "a", mid + 60_000 + msFor(4))).toBeCloseTo(sec(72) + 16, 2);
    expect(mixAt(d, deckBeat(d, mid + 60_000 + msFor(20))).xfade).toBe(0);
  });

  it("can start now, or be called off (the incoming record stays at its cue)", () => {
    const a = onB();
    send(a.s, { cmd: "mixnow" }, T0 + 1000);
    expect(a.d.mix!.start).toBeCloseTo(deckBeat(a.d, T0 + 1000));
    expect(posOf(a.d, "a", T0 + 1000 + msFor(2))).toBeCloseTo(sec(72) + 2, 2);
    const b = onB();
    send(b.s, { cmd: "unmix" }, T0 + 1000);
    expect(b.d.mix).toBeNull();
    expect(posOf(b.d, "a", T0 + 30_000)).toBeCloseTo(sec(72), 2);
    expect(b.d.xfade).toBe(1);
  });

  it("follows the record on air: a pause holds it, a jump moves it, and a jump past calls it off", () => {
    const { s, d } = onB();
    send(s, { cmd: "transport", side: "b", playing: false }, T0 + 2000);
    expect(d.mix!.start).toBeNull();
    expect(posOf(d, "a", T0 + 9000)).toBeCloseTo(sec(72), 2);
    send(s, { cmd: "transport", side: "b", playing: true }, T0 + 9000);
    expect(d.mix!.start).toBeCloseTo(deckBeat(d, T0 + 12_000), 2);
    send(s, { cmd: "cue", side: "b", pos: sec(150) }, T0 + 9000);
    expect(d.mix!.start).toBeCloseTo(deckBeat(d, T0 + 24_000), 2);
    // the incoming record's cue can still be moved while it waits
    send(s, { cmd: "cue", side: "a", pos: sec(30) }, T0 + 9000);
    expect(posOf(d, "a", T0 + 10_000)).toBeCloseTo(sec(30), 2);
    send(s, { cmd: "cue", side: "b", pos: sec(200) }, T0 + 10_000);
    expect(d.mix).toBeNull();
    expect(send(s, { cmd: "mix", style: "bass", bars: 8, at: sec(165), inAt: sec(72) }, T0 + 10_000).changed).toBe(false);
  });

  it("stays queued through a save", () => {
    const { s } = onB();
    const d = restoredParty(savedParty(s.party!, T0 + 2000))!.deck!;
    expect(d.mix).toMatchObject({ style: "bass", at: placeIn("back-to-u", sec(165)), inAt: placeIn("take-me", sec(72)) });
    expect(trackPosition(d, "a", d.beat)).toBeCloseTo(sec(72), 2);
    expect(trackPosition(d, "b", d.beat)).toBeCloseTo(sec(162), 1);
  });
});

describe("DJ sets", () => {
  it("records the mix as you go: records in order, where each started, and each transition", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "take-me", b: "back-to-u", xfade: 1 } }, T0);
    send(s, { cmd: "cue", side: "b", pos: sec(160) }, T0);
    send(s, { cmd: "deck", set: { playing: true } }, T0);
    send(s, { cmd: "mix", style: "bass", bars: 8, at: sec(165), inAt: sec(72) }, T0);
    const d = s.party!.deck!;
    expect(d.set).toMatchObject({
      step: 0,
      steps: [
        { track: "back-to-u", from: placeIn("back-to-u", sec(160)), next: { at: placeIn("back-to-u", sec(165)), style: "bass", bars: 8 } },
        { track: "take-me", from: placeIn("take-me", sec(72)) },
      ],
    });
    // the transition finishes; the set moves on to the record now on air
    send(s, { cmd: "setstep" }, T0 + 5000 + msFor(33));
    expect(d.set!.step).toBe(1);
    // and the next transition carries on the same set
    send(s, { cmd: "deck", set: { b: "atlasaudio-edm" } }, T0 + 40_000);
    send(s, { cmd: "mix", style: "echo", bars: 4 }, T0 + 40_000);
    expect(d.set!.steps.map((x) => x.track)).toEqual(["back-to-u", "take-me", "atlasaudio-edm"]);
    expect(d.set!.steps[1]!.next).toMatchObject({ style: "echo", bars: 4 });
  });

  it("loads paused with the first transition queued, and plays through, setting up each next record", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { playing: true } }, T0);
    const set = {
      name: "Friday",
      steps: [
        { track: "back-to-u", from: sec(160), cues: [sec(30)], next: { at: sec(165), style: "bass", bars: 8 } },
        { track: "take-me", from: sec(72), cues: [], next: { at: sec(90), style: "blend", bars: 4 } },
        { track: "atlasaudio-edm", from: sec(10), cues: [] },
      ],
    };
    send(s, { cmd: "setload", set }, T0 + 1000);
    const d = s.party!.deck!;
    expect(d).toMatchObject({ playing: false, a: "back-to-u", b: "take-me", xfade: 0, set: { name: "Friday", step: 0 } });
    expect(d.mix).toMatchObject({ style: "bass", to: 1, at: placeIn("back-to-u", sec(165)), inAt: placeIn("take-me", sec(72)) });
    expect(d.marks?.["back-to-u"]).toEqual([placeIn("back-to-u", sec(30))]);
    expect(posOf(d, "a", T0 + 60_000)).toBeCloseTo(sec(160), 2);
    expect(posOf(d, "b", T0 + 60_000)).toBeCloseTo(sec(72), 2);
    // press play: B comes in when A reaches 2:45
    const t = T0 + 100_000;
    send(s, { cmd: "deck", set: { playing: true } }, t);
    expect(d.mix!.start).toBeCloseTo(deckBeat(d, t + 5000), 2);
    expect(posOf(d, "b", t + 5000 + msFor(8))).toBeCloseTo(sec(72) + 8, 2);
    // after it: the third record is parked on A for a blend when B gets to 1:30
    const after = t + 5000 + msFor(33);
    send(s, { cmd: "setstep" }, after);
    expect(d).toMatchObject({ a: "atlasaudio-edm", xfade: 1, set: { step: 1 } });
    expect(d.mix).toMatchObject({ style: "blend", to: 0, beats: 16 });
    expect(posOf(d, "a", after + 1000)).toBeCloseTo(sec(10), 2);
    const bNow = posOf(d, "b", after);
    expect(d.mix!.start).toBeCloseTo(deckBeat(d, after) + (sec(90) - bNow), 4);
    // nothing more to queue after the last one
    send(s, { cmd: "setstep" }, after + msFor(sec(90) - bNow) + msFor(17));
    expect(d).toMatchObject({ mix: null, xfade: 0, set: { step: 2 } });
    expect(send(s, { cmd: "setstep" }, after + 200_000).changed).toBe(false);
  });

  it("links a chain of records onto the one playing, and plays through them one after another", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "back-to-u", b: null, xfade: 0, playing: true } }, T0);
    send(s, { cmd: "cue", side: "a", pos: sec(100) }, T0);
    const d = s.party!.deck!;
    // 1 (on air) ➜ 2 ➜ 3 ➜ 4
    const chain = [
      { track: "back-to-u", from: 0, cues: [], next: { at: sec(110), style: "blend", bars: 4 } },
      { track: "take-me", from: sec(20), cues: [], next: { at: sec(30), style: "bass", bars: 4 } },
      { track: "atlasaudio-edm", from: sec(5), cues: [], next: { at: sec(15), style: "echo", bars: 2 } },
      { track: "fuck-the-speakerz-up", from: sec(1), cues: [] },
    ];
    expect(send(s, { cmd: "setchain", steps: chain }, T0 + 1000).changed).toBe(true);
    // the record on air keeps playing from where it is; the second is parked on B for the first link
    expect(d).toMatchObject({ playing: true, a: "back-to-u", b: "take-me", set: { step: 0 } });
    expect(d.set!.steps.map((x) => x.track)).toEqual(["back-to-u", "take-me", "atlasaudio-edm", "fuck-the-speakerz-up"]);
    expect(d.mix).toMatchObject({ style: "blend", to: 1, at: placeIn("back-to-u", sec(110)), inAt: placeIn("take-me", sec(20)) });
    expect(posOf(d, "a", T0 + 2000)).toBeCloseTo(sec(102), 1);
    // each link plays out in turn
    let t = T0 + 1000 + 9000 + msFor(17);
    send(s, { cmd: "setstep" }, t);
    expect(d).toMatchObject({ a: "atlasaudio-edm", b: "take-me", xfade: 1, set: { step: 1 } });
    expect(d.mix).toMatchObject({ style: "bass", to: 0, inAt: placeIn("atlasaudio-edm", sec(5)) });
    t += msFor(sec(30) - posOf(d, "b", t)) + msFor(17);
    send(s, { cmd: "setstep" }, t);
    expect(d).toMatchObject({ a: "atlasaudio-edm", b: "fuck-the-speakerz-up", xfade: 0, set: { step: 2 } });
    expect(d.mix).toMatchObject({ style: "echo", to: 1 });
    // changing what's up next replaces the queued link (the record on air carries on)
    send(s, { cmd: "setchain", steps: [{ track: "atlasaudio-edm", from: 0, cues: [], next: { at: sec(40), style: "cut", bars: 1 } }, { track: "kulakovka-hard-edm", from: 0, cues: [] }] }, t + 100);
    expect(d).toMatchObject({ b: "kulakovka-hard-edm", set: { step: 2 } });
    expect(d.set!.steps.map((x) => x.track)).toEqual(["back-to-u", "take-me", "atlasaudio-edm", "kulakovka-hard-edm"]);
    expect(d.mix).toMatchObject({ style: "cut", at: placeIn("atlasaudio-edm", sec(40)) });
  });

  it("only links a chain onto the record on air", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "back-to-u", b: null, xfade: 0, playing: true } }, T0);
    const steps = [
      { track: "take-me", from: 0, cues: [], next: { at: sec(30), style: "blend", bars: 4 } },
      { track: "atlasaudio-edm", from: 0, cues: [] },
    ];
    expect(send(s, { cmd: "setchain", steps }, T0 + 1000).changed).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "setchain", steps: [] }).success).toBe(false);
  });

  it("appends songs from the crate without disrupting playback or an existing link", () => {
    const s = fresh();
    send(s, { cmd: "deck", set: { a: "back-to-u", b: null, xfade: 0, bpm: 120, playing: true } }, T0);
    send(s, { cmd: "setappend", track: "take-me" }, T0 + 1000);
    const d = s.party!.deck!;
    expect(d).toMatchObject({ playing: true, a: "back-to-u", b: "take-me", set: { step: 0, name: null } });
    expect(posOf(d, "a", T0 + 1000)).toBeCloseTo(2);
    const firstLink = { ...d.mix };
    send(s, { cmd: "setappend", track: "atlasaudio-edm" }, T0 + 2000);
    expect(d.set!.steps.map((x) => x.track)).toEqual(["back-to-u", "take-me", "atlasaudio-edm"]);
    expect(d.mix).toEqual(firstLink);
    send(s, { cmd: "mixnow" }, T0 + 3000);
    send(s, { cmd: "setappend", track: "night-bus" }, T0 + 4000);
    expect(d.set!.steps).toHaveLength(4);
    send(s, { cmd: "setstep" }, T0 + 20_000);
    expect(d).toMatchObject({ a: "atlasaudio-edm", b: "take-me", xfade: 1, set: { step: 1 } });
    const restored = restoredParty(JSON.parse(JSON.stringify(savedParty(s.party!, T0 + 21_000))))!;
    expect(restored.deck!.set).toEqual(d.set);
  });

  it("starts a saved set at a selected record and jumps by index while keeping the rest of the set", () => {
    const s = fresh();
    const set = {
      name: "Rehearsal",
      steps: [
        { track: "back-to-u", from: sec(40), cues: [sec(30)], next: { at: sec(90), style: "echo", bars: 4 } },
        { track: "take-me", from: sec(20), cues: [], next: { at: sec(35), style: "bass", bars: 4 } },
        { track: "back-to-u", from: sec(60), cues: [], next: { at: sec(80), style: "cut", bars: 1 } },
        { track: "atlasaudio-edm", from: sec(5), cues: [] },
      ],
    };
    send(s, { cmd: "setload", set, step: 2, playing: true }, T0);
    const d = s.party!.deck!;
    expect(d).toMatchObject({ a: "back-to-u", b: "atlasaudio-edm", playing: true, mix: { style: "cut" }, set: { step: 2 } });
    expect(posOf(d, "a", T0)).toBeCloseTo(sec(60), 2);
    expect(posOf(d, "b", T0)).toBeCloseTo(sec(5), 2);
    expect(d.marks?.["back-to-u"]).toEqual([placeIn("back-to-u", sec(30))]);
    send(s, { cmd: "setjump", step: 0, track: "take-me" }, T0 + 1000);
    send(s, { cmd: "setload", set, step: 4 }, T0 + 1000);
    expect(d).toMatchObject({ a: "back-to-u", b: "atlasaudio-edm", playing: true, set: { step: 2 } });
    send(s, { cmd: "mixnow" }, T0 + 2000);
    send(s, { cmd: "setjump", step: 0, track: "back-to-u" }, T0 + 2100);
    expect(d).toMatchObject({ a: "back-to-u", b: "take-me", playing: true, mix: { style: "echo" }, set: { step: 0 } });
    expect(posOf(d, "a", T0 + 2100)).toBeCloseTo(sec(40), 2);
    expect(d.set!.steps).toHaveLength(4);
    send(s, { cmd: "deck", set: { playing: false } }, T0 + 3000);
    send(s, { cmd: "setjump", step: 3, track: "atlasaudio-edm" }, T0 + 4000);
    expect(d).toMatchObject({ a: "atlasaudio-edm", b: null, playing: false, mix: null, set: { step: 3 } });
    expect(posOf(d, "a", T0 + 6000)).toBeCloseTo(sec(5), 2);
  });

  it("checks a set before loading it", () => {
    expect(PartyCmd.safeParse({ cmd: "setload", set: { name: "x", steps: [] } }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "setload", set: { name: "x", steps: [{ track: "nope", from: 0, cues: [] }] } }).success).toBe(false);
    expect(PartyCmd.safeParse({ cmd: "setload", set: { name: "x", steps: [{ track: "take-me", from: 0, cues: [], next: { at: 4, style: "blend", bars: 3 } }] } }).success).toBe(false);
  });
});
