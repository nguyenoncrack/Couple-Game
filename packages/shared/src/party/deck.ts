/**
 * The DJ deck: two turntables of the game's own music, a crossfader between them, a filter, an echo and a drop.
 * Each screen plays the same records using the shared beat clock. Synthesized records follow its beat directly.
 * Recordings use it to keep their playback position in sync across players.
 *
 * The beat follows the server clock: at server time `t` the beat count was `beat`, and while playing it moves on at
 * `bpm`. Every change re-anchors it there, so a change of tempo never jumps the music.
 */

const PATTERN_TRACKS = [
  { id: "neon-drift", name: "Neon Drift", style: "House", color: "#ff2bd6" },
  { id: "sunset-loop", name: "Sunset Loop", style: "Deep house", color: "#ff9a3c" },
  { id: "pillow-fort", name: "Pillow Fort", style: "Lo-fi house", color: "#b18cff" },
  { id: "rain-on-glass", name: "Rain on Glass", style: "Chill", color: "#5ec8ff" },
  { id: "disco-kettle", name: "Disco Kettle", style: "Nu-disco", color: "#ffd166" },
  { id: "night-bus", name: "Night Bus", style: "Techno", color: "#39ff88" },
] as const;
export const RECORDED_TRACKS = [
  { id: "atlasaudio-edm", name: "EDM", style: "AtlasAudio", color: "#22d3ee", seconds: 130.19 },
  { id: "kulakovka-hard-edm", name: "Hard EDM", style: "Kulakovka", color: "#ff556d", seconds: 141.95 },
  { id: "sad-machine-ksk-edit", name: "Sad Machine (KSK Edit)", style: "Porter Robinson", color: "#a78bfa", seconds: 366.84 },
  { id: "fuck-the-speakerz-up", name: "FUCK THE SPEAKERZ UP", style: "ISOxo", color: "#ff643b", seconds: 166.45 },
  { id: "hard-summer-2017-live", name: "HARD SUMMER 2017 LIVE", style: "4B", color: "#bafa45", seconds: 4346.6 },
  { id: "back-to-u", name: "Back To U", style: "SLANDER & William Black", color: "#58a6ff", seconds: 259.45 },
  { id: "take-me", name: "Take Me", style: "William Black & Matte feat. RUNN", color: "#f693c5", seconds: 192.05 },
] as const;
export type PatternTrackId = (typeof PATTERN_TRACKS)[number]["id"];
export type RecordedTrackId = (typeof RECORDED_TRACKS)[number]["id"];
export const DECK_TRACKS = [...PATTERN_TRACKS, ...RECORDED_TRACKS] as const;
export type DeckTrackId = (typeof DECK_TRACKS)[number]["id"];
export const DECK_TRACK_IDS = DECK_TRACKS.map((t) => t.id) as [DeckTrackId, ...DeckTrackId[]];
export const deckTrack = (id: string | null) => DECK_TRACKS.find((t) => t.id === id) ?? DECK_TRACKS[0];
export const isRecording = (id: string | null): boolean => RECORDED_TRACKS.some((t) => t.id === id);

export const MIN_BPM = 100;
export const MAX_BPM = 140;
/** The tempo a recording plays at its own speed (and the tempo every record's length is counted in). */
export const DEFAULT_BPM = 124;
/** A built-in record goes round in 32-bar phrases. */
export const PHRASE_BEATS = 128;

/**
 * How long a record is, in beats at the default tempo: a recording's own length, or a built-in record's phrase.
 * Positions in a record ("track beats") are counted the same way, so a tempo change speeds a record up, not jumps it.
 */
export function trackBeats(id: DeckTrackId): number {
  const rec = RECORDED_TRACKS.find((t) => t.id === id);
  return rec ? (rec.seconds * DEFAULT_BPM) / 60 : PHRASE_BEATS;
}

export type DeckSide = "a" | "b";
export const otherSide = (side: DeckSide): DeckSide => (side === "a" ? "b" : "a");

/** One deck's channel on the mixer: its own volume, and a three-band EQ (-1 cuts the band out, +1 lifts it a little). */
export interface DeckChannel {
  vol: number;
  low: number;
  mid: number;
  high: number;
}
export const FLAT_CHANNEL: DeckChannel = { vol: 1, low: 0, mid: 0, high: 0 };

/** Ways to go from one deck to the other. */
export const MIX_STYLES = [
  { id: "blend", name: "Blend", hint: "Fades one into the other" },
  { id: "bass", name: "Bass swap", hint: "Both play; the bass lines swap halfway" },
  { id: "echo", name: "Echo out", hint: "The old track echoes away as the new one comes in" },
  { id: "filter", name: "Filter out", hint: "The old track thins out, then the new one takes over" },
  { id: "cut", name: "Cut", hint: "Switches over on the bar line" },
] as const;
export type MixStyle = (typeof MIX_STYLES)[number]["id"];
export const MIX_STYLE_IDS = MIX_STYLES.map((m) => m.id) as [MixStyle, ...MixStyle[]];
/** How long a transition can take, in bars. */
export const MIX_BARS = [1, 2, 4, 8, 16] as const;

/** A transition under way: from crossfader `from` to the `to` end, over `beats` from beat `start` (a bar line). */
export interface DeckMix {
  style: MixStyle;
  from: number;
  to: 0 | 1;
  start: number;
  beats: number;
}

export const MAX_MARKS = 8;

export interface Deck {
  /** The record on each deck, or null for an empty deck (one record can play on its own). */
  a: DeckTrackId | null;
  b: DeckTrackId | null;
  /** 0 is all deck A, 1 all deck B (while a transition runs, `mixAt` says where it really is). */
  xfade: number;
  bpm: number;
  playing: boolean;
  /** The anchor: at server time `t` (ms) the beat count was `beat`. */
  t: number;
  beat: number;
  /** -1 muffles the music (low-pass), 0 leaves it open, 1 thins it out (high-pass). */
  filter: number;
  /**
   * Where each record started, as a beat of the deck's clock: the record is `beat - cue` track beats in. Set when a
   * record is loaded (built-in records start on a bar line) and moved to jump to another part. Older decks: zero.
   */
  cueA?: number;
  cueB?: number;
  /** The saved drop position on each loaded record, in track beats. */
  dropCueA?: number;
  dropCueB?: number;
  /** A deck paused on its own: its record held at this place (track beats), whatever the deck's clock does. */
  holdA?: number;
  holdB?: number;
  /** Saved cue points for each record, in track beats, in order. */
  marks?: Partial<Record<DeckTrackId, number[]>>;
  /** Each deck's channel (flat when missing). */
  chA?: DeckChannel;
  chB?: DeckChannel;
  /** A transition from one deck to the other, if one is under way. */
  mix?: DeckMix | null;
  echo: boolean;
  /** The beat a build-up starts on (the drop lands `BUILD_BEATS` later), or null. */
  drop: number | null;
}

export const DEFAULT_DECK: Deck = { a: "neon-drift", b: "sunset-loop", xfade: 0, bpm: DEFAULT_BPM, playing: false, t: 0, beat: 0, filter: 0, echo: false, drop: null };

/** A build-up lasts two bars, and the drop after it four. */
export const BUILD_BEATS = 8;
export const DROP_BEATS = 16;

/** Where the beat is at server time `now`. */
export function deckBeat(d: Pick<Deck, "playing" | "t" | "beat" | "bpm">, now: number): number {
  return d.playing ? d.beat + (Math.max(0, now - d.t) * d.bpm) / 60_000 : d.beat;
}

export const dropCueOf = (d: Deck, side: DeckSide): number | undefined => side === "a" ? d.dropCueA : d.dropCueB;
export const cueOf = (d: Pick<Deck, "cueA" | "cueB">, side: DeckSide) => (side === "a" ? d.cueA : d.cueB) ?? 0;
export const channelOf = (d: Pick<Deck, "chA" | "chB">, side: DeckSide): DeckChannel => (side === "a" ? d.chA : d.chB) ?? FLAT_CHANNEL;

export const holdOf = (d: Pick<Deck, "holdA" | "holdB">, side: DeckSide) => (side === "a" ? d.holdA : d.holdB);
export const marksOf = (d: Pick<Deck, "marks">, id: DeckTrackId | null): number[] => (id ? (d.marks?.[id] ?? []) : []);

/** Whether a deck's record is moving: the deck is playing, and this record isn't paused on its own. */
export const deckRunning = (d: Deck, side: DeckSide, _beat?: number) => Boolean(d[side]) && d.playing && holdOf(d, side) === undefined;

/**
 * How far into its record a deck is at `beat`, in track beats (it goes round when it gets to the end), or null if
 * empty. A paused deck stays where it was held.
 */
export function trackPosition(d: Deck, side: DeckSide, beat: number): number | null {
  const id = d[side];
  if (!id) return null;
  const len = trackBeats(id);
  const hold = holdOf(d, side);
  if (hold !== undefined) return Math.min(Math.max(0, hold), len - 0.01);
  return (((beat - cueOf(d, side)) % len) + len) % len;
}

/** A place in a record, kept inside it. Built-in records keep to sixteenths, so their notes stay on the grid. */
export function placeIn(id: DeckTrackId, pos: number): number {
  const p = Math.min(Math.max(0, pos), trackBeats(id) - 0.01);
  return isRecording(id) ? Math.round(p * 1000) / 1000 : Math.round(p * 4) / 4;
}

/**
 * The cue that puts a deck `pos` track beats into its record at `beat`. A built-in record keeps to the deck's bars
 * (so it stays in time with the other deck), landing in the bar that starts at `pos`.
 */
export function cueFor(id: DeckTrackId, beat: number, pos: number): number {
  const p = Math.min(Math.max(0, pos), trackBeats(id) - 0.01);
  return isRecording(id) ? beat - p : Math.floor((beat - p) / 4 + 1e-9) * 4;
}

/** What a transition does to one deck's sound beyond its own channel: EQ cuts (-1 to 0) and how much goes into the echo. */
export interface SideFx {
  low: number;
  mid: number;
  high: number;
  echo: number;
}
const NO_FX: SideFx = { low: 0, mid: 0, high: 0, echo: 0 };

export interface MixNow {
  xfade: number;
  fx: Record<DeckSide, SideFx>;
  /** How far through the transition, 0 to 1, or null when there's none (or it's over). */
  progress: number | null;
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/** Where the crossfader really is at `beat`, and what a transition is doing to each deck then. */
export function mixAt(d: Pick<Deck, "xfade" | "mix">, beat: number): MixNow {
  const m = d.mix;
  if (!m) return { xfade: d.xfade, fx: { a: NO_FX, b: NO_FX }, progress: null };
  const k = Math.min(1, Math.max(0, (beat - m.start) / m.beats));
  if (k >= 1) return { xfade: m.to, fx: { a: NO_FX, b: NO_FX }, progress: null };
  const out: DeckSide = m.to === 1 ? "a" : "b";
  const into = otherSide(out);
  const toward = (t: number) => m.from + (m.to - m.from) * Math.min(1, Math.max(0, t));
  const fx: Record<DeckSide, SideFx> = { a: { ...NO_FX }, b: { ...NO_FX } };
  let xfade = m.from;
  switch (m.style) {
    case "blend":
      xfade = toward(smooth(k));
      break;
    case "bass":
      // both up together, but only one bass line at a time: the new one's until halfway, then the old one's goes
      xfade = toward(k);
      if (k < 0.5) fx[into].low = -1;
      else fx[out].low = -1;
      break;
    case "echo":
      // the old track goes into the echo straight away and fades out under it as the new one comes up
      xfade = toward(smooth(k));
      if (beat >= m.start) fx[out].echo = 1;
      break;
    case "filter":
      // the old track loses its bass and then its middle, and the new one takes over in the last part
      fx[out].low = -Math.min(1, k * 1.6);
      fx[out].mid = -Math.min(1, Math.max(0, k * 1.6 - 0.35));
      xfade = toward((k - 0.6) / 0.4);
      break;
    case "cut":
      break;
  }
  return { xfade, fx, progress: k };
}

/** Put a finished transition away: the crossfader stays where it ended. */
export function settleMix(d: Deck, beat: number) {
  if (d.mix && beat >= d.mix.start + d.mix.beats) {
    d.xfade = d.mix.to;
    d.mix = null;
  }
}

/** Re-anchor the beat at `now` (before changing the tempo, or playing or pausing). */
export function anchorDeck(d: Deck, now: number) {
  d.beat = deckBeat(d, now);
  d.t = now;
}

export type Section = "intro" | "groove" | "full" | "break" | "rise" | "build" | "drop";

/**
 * Which part of the track is playing at a beat: a 32-bar phrase of intro (8 bars), groove (8), full (8), a
 * breakdown (4) and a rise back in (4), unless a drop is under way, which takes over for its build and its drop.
 */
export function sectionAt(beat: number, drop: number | null): Section {
  if (drop !== null && beat >= drop) {
    if (beat < drop + BUILD_BEATS) return "build";
    if (beat < drop + BUILD_BEATS + DROP_BEATS) return "drop";
  }
  const bar = Math.floor((((beat % PHRASE_BEATS) + PHRASE_BEATS) % PHRASE_BEATS) / 4);
  if (bar < 8) return "intro";
  if (bar < 16) return "groove";
  if (bar < 24) return "full";
  if (bar < 28) return "break";
  return "rise";
}

/** The part of a built-in record a deck is in: its own place in the phrase, unless a drop (on the deck's clock) takes over. */
export function sectionOf(local: number, beat: number, drop: number | null): Section {
  const s = sectionAt(beat, drop);
  return s === "build" || s === "drop" ? s : sectionAt(local, null);
}

/** Whether the kick drum is playing in a section (what speakers thump to). */
export const kickIn = (s: Section) => s !== "break" && s !== "build";

/**
 * How hard the speakers are pushed at a beat, 0 to 1: a thump on every beat that dies away before the next, stronger
 * in a drop, and nothing while the kick is out.
 */
export function deckPump(beat: number, drop: number | null): number {
  const s = sectionAt(beat, drop);
  if (!kickIn(s)) return 0;
  const f = beat - Math.floor(beat);
  return (s === "drop" ? 1 : s === "intro" ? 0.6 : 0.8) * Math.exp(-f * 6);
}

/** A saved or sent deck, checked into shape. */
export function restoredDeck(saved: Partial<Deck> | undefined): Deck {
  const d = { ...DEFAULT_DECK };
  if (!saved || typeof saved !== "object") return d;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const track = (v: unknown, fallback: DeckTrackId | null) => (v === null ? null : DECK_TRACK_IDS.includes(v as DeckTrackId) ? (v as DeckTrackId) : fallback);
  d.a = track(saved.a, d.a);
  d.b = track(saved.b, d.b);
  // a transition that was under way is finished
  const mix = saved.mix && typeof saved.mix === "object" ? saved.mix : null;
  d.xfade = mix && (mix.to === 0 || mix.to === 1) ? mix.to : num(saved.xfade, 0, 1, d.xfade);
  d.bpm = num(saved.bpm, MIN_BPM, MAX_BPM, d.bpm);
  d.beat = num(saved.beat, 0, 1e7, 0);
  if (saved.cueA !== undefined) d.cueA = num(saved.cueA, -1e7, d.beat, 0);
  if (saved.cueB !== undefined) d.cueB = num(saved.cueB, -1e7, d.beat, 0);
  if (d.a && typeof saved.dropCueA === "number" && Number.isFinite(saved.dropCueA)) d.dropCueA = num(saved.dropCueA, 0, trackBeats(d.a) - 0.01, 0);
  if (d.b && typeof saved.dropCueB === "number" && Number.isFinite(saved.dropCueB)) d.dropCueB = num(saved.dropCueB, 0, trackBeats(d.b) - 0.01, 0);
  if (d.a && !d.b) d.xfade = 0;
  if (!d.a && d.b) d.xfade = 1;
  for (const side of ["a", "b"] as const) {
    const id = d[side];
    if (!id) continue;
    const S = side === "a" ? "A" : "B";
    const len = trackBeats(id);
    const hold = saved[`hold${S}`];
    if (typeof hold === "number" && Number.isFinite(hold)) d[`hold${S}`] = num(hold, 0, len - 0.01, 0);
  }
  const marks = restoredMarks(saved.marks);
  if (marks) d.marks = marks;
  const channel = (c: unknown): DeckChannel | undefined => {
    if (!c || typeof c !== "object") return undefined;
    const v = c as Partial<DeckChannel>;
    return { vol: num(v.vol, 0, 1, 1), low: num(v.low, -1, 1, 0), mid: num(v.mid, -1, 1, 0), high: num(v.high, -1, 1, 0) };
  };
  const chA = channel(saved.chA);
  const chB = channel(saved.chB);
  if (chA) d.chA = chA;
  if (chB) d.chB = chB;
  d.filter = num(saved.filter, -1, 1, 0);
  d.echo = saved.echo === true;
  // kept paused, as the rest of the music is
  d.playing = false;
  d.t = 0;
  d.drop = null;
  return d;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const goodTrack = (v: unknown): v is DeckTrackId => DECK_TRACK_IDS.includes(v as DeckTrackId);

/** A list of cue points on a record, checked: in order, inside the record, no more than `MAX_MARKS`. */
export function restoredCues(id: DeckTrackId, v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const p of v) if (finite(p) && !out.some((q) => Math.abs(q - placeIn(id, p)) < 0.05)) out.push(placeIn(id, p));
  return out.sort((x, y) => x - y).slice(0, MAX_MARKS);
}

function restoredMarks(v: unknown): Deck["marks"] | null {
  if (!v || typeof v !== "object") return null;
  const marks: NonNullable<Deck["marks"]> = {};
  for (const [id, list] of Object.entries(v)) {
    if (!goodTrack(id)) continue;
    const cues = restoredCues(id, list);
    if (cues.length) marks[id] = cues;
  }
  return Object.keys(marks).length ? marks : null;
}
