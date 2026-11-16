/**
 * The DJ deck: two turntables of the game's own music, a crossfader between them, a filter, an echo and a drop.
 * The tracks are made on each screen from the same notes (nothing is downloaded), so all the house keeps is which
 * record is on which deck and where the beat is. Both decks always play in time with each other (one tempo, one
 * beat), so any mix sounds right.
 *
 * The beat follows the server clock: at server time `t` the beat count was `beat`, and while playing it moves on at
 * `bpm`. Every change re-anchors it there, so a change of tempo never jumps the music.
 */

export const DECK_TRACKS = [
  { id: "neon-drift", name: "Neon Drift", style: "House", color: "#ff2bd6" },
  { id: "sunset-loop", name: "Sunset Loop", style: "Deep house", color: "#ff9a3c" },
  { id: "pillow-fort", name: "Pillow Fort", style: "Lo-fi house", color: "#b18cff" },
  { id: "rain-on-glass", name: "Rain on Glass", style: "Chill", color: "#5ec8ff" },
  { id: "disco-kettle", name: "Disco Kettle", style: "Nu-disco", color: "#ffd166" },
  { id: "night-bus", name: "Night Bus", style: "Techno", color: "#39ff88" },
] as const;
export type DeckTrackId = (typeof DECK_TRACKS)[number]["id"];
export const DECK_TRACK_IDS = DECK_TRACKS.map((t) => t.id) as [DeckTrackId, ...DeckTrackId[]];
export const deckTrack = (id: string) => DECK_TRACKS.find((t) => t.id === id) ?? DECK_TRACKS[0];

export const MIN_BPM = 100;
export const MAX_BPM = 140;

export interface Deck {
  a: DeckTrackId;
  b: DeckTrackId;
  /** 0 is all deck A, 1 all deck B. */
  xfade: number;
  bpm: number;
  playing: boolean;
  /** The anchor: at server time `t` (ms) the beat count was `beat`. */
  t: number;
  beat: number;
  /** -1 muffles the music (low-pass), 0 leaves it open, 1 thins it out (high-pass). */
  filter: number;
  echo: boolean;
  /** The beat a build-up starts on (the drop lands `BUILD_BEATS` later), or null. */
  drop: number | null;
}

export const DEFAULT_DECK: Deck = { a: "neon-drift", b: "sunset-loop", xfade: 0, bpm: 124, playing: false, t: 0, beat: 0, filter: 0, echo: false, drop: null };

/** A build-up lasts two bars, and the drop after it four. */
export const BUILD_BEATS = 8;
export const DROP_BEATS = 16;
/** The music goes round in 32-bar phrases. */
export const PHRASE_BEATS = 128;

/** Where the beat is at server time `now`. */
export function deckBeat(d: Pick<Deck, "playing" | "t" | "beat" | "bpm">, now: number): number {
  return d.playing ? d.beat + (Math.max(0, now - d.t) * d.bpm) / 60_000 : d.beat;
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
  const track = (v: unknown, fallback: DeckTrackId) => (DECK_TRACK_IDS.includes(v as DeckTrackId) ? (v as DeckTrackId) : fallback);
  d.a = track(saved.a, d.a);
  d.b = track(saved.b, d.b);
  d.xfade = num(saved.xfade, 0, 1, d.xfade);
  d.bpm = num(saved.bpm, MIN_BPM, MAX_BPM, d.bpm);
  d.beat = num(saved.beat, 0, 1e7, 0);
  d.filter = num(saved.filter, -1, 1, 0);
  d.echo = saved.echo === true;
  // kept paused, as the rest of the music is
  d.playing = false;
  d.t = 0;
  d.drop = null;
  return d;
}
