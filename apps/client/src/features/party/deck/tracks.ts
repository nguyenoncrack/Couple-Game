import type { DeckTrackId, Section } from "@cg/shared";

/**
 * The deck's records, written as patterns: one bar of drums and lines in sixteenths, and a four-bar run of chords.
 * Every record is in A minor (or near it), so any two mix without clashing, and the deck plays them all at one tempo.
 *
 * Step strings are 16 characters, one per sixteenth: `.` is a rest, `x` a hit and `X` an accented one. In the bass,
 * `r` is the bar's root, `o` the root an octave up and `f` its fifth. In the lead, a digit picks a note of the bar's
 * chord (0 its lowest), and 4 to 7 the same an octave higher.
 */

export interface TrackDef {
  id: DeckTrackId;
  /** Per bar, cycling: the bass root and the chord, as semitones from A. */
  bars: readonly (readonly [root: number, chord: readonly number[]])[];
  kick: string;
  clap: string;
  hat: string;
  open: string;
  bass: string;
  lead: string;
  bassWave: OscillatorType;
  /** Where the bass filter settles (Hz). */
  bassCut: number;
  leadWave: OscillatorType;
  leadCut: number;
  /** How long a lead note rings (seconds). */
  leadDecay: number;
  /** How loud the chord pad is (0 for none). */
  pad: number;
  /** How far the off sixteenths are pushed late, as a share of a sixteenth. */
  swing: number;
  /** Where the kick's pitch starts (Hz): higher is punchier. */
  kickTone: number;
}

const FOUR = "x...x...x...x...";
const TWO_FOUR = "....x.......x...";

export const TRACK_DEFS: Record<DeckTrackId, TrackDef> = {
  "neon-drift": {
    id: "neon-drift",
    bars: [
      [0, [0, 3, 7]],
      [-4, [-4, 0, 3]],
      [3, [3, 7, 10]],
      [-2, [-2, 2, 5]],
    ],
    kick: FOUR,
    clap: TWO_FOUR,
    hat: "xxXxxxXxxxXxxxXx",
    open: "..x...x...x...x.",
    bass: "..r...r...r..or.",
    lead: "0.1.2.4.2.1.0.2.",
    bassWave: "sawtooth",
    bassCut: 420,
    leadWave: "square",
    leadCut: 1800,
    leadDecay: 0.16,
    pad: 0.55,
    swing: 0,
    kickTone: 160,
  },
  "sunset-loop": {
    id: "sunset-loop",
    bars: [
      [0, [0, 3, 7, 10]],
      [5, [5, 8, 12, 15]],
      [7, [7, 10, 14, 17]],
      [0, [0, 3, 7, 10]],
    ],
    kick: FOUR,
    clap: TWO_FOUR,
    hat: "..x...x...x...x.",
    open: "......x.......x.",
    bass: "r.....r.r.....r.",
    lead: "4......6....5...",
    bassWave: "triangle",
    bassCut: 380,
    leadWave: "triangle",
    leadCut: 2400,
    leadDecay: 0.45,
    pad: 0.8,
    swing: 0.08,
    kickTone: 130,
  },
  "pillow-fort": {
    id: "pillow-fort",
    bars: [
      [-4, [-4, 0, 3, 7]],
      [-5, [-5, -2, 2, 5]],
      [-7, [-7, -4, 0, 3]],
      [3, [3, 7, 10, 14]],
    ],
    kick: FOUR,
    clap: TWO_FOUR,
    hat: "x.x.x.x.x.x.x.x.",
    open: "..............x.",
    bass: "r..r....r..r....",
    lead: "..2...1.....3...",
    bassWave: "sine",
    bassCut: 300,
    leadWave: "triangle",
    leadCut: 1500,
    leadDecay: 0.6,
    pad: 0.9,
    swing: 0.16,
    kickTone: 110,
  },
  "rain-on-glass": {
    id: "rain-on-glass",
    bars: [
      [0, [0, 3, 7, 14]],
      [3, [3, 7, 10, 14]],
      [-2, [-2, 2, 5, 9]],
      [-4, [-4, 0, 3, 7]],
    ],
    kick: FOUR,
    clap: "............x...",
    hat: "..x...x...x...x.",
    open: "................",
    bass: "r.......r.....r.",
    lead: "4.....5.....6...",
    bassWave: "sine",
    bassCut: 260,
    leadWave: "sine",
    leadCut: 3000,
    leadDecay: 0.9,
    pad: 1,
    swing: 0.1,
    kickTone: 100,
  },
  "disco-kettle": {
    id: "disco-kettle",
    bars: [
      [5, [5, 8, 12, 15]],
      [-2, [-2, 2, 5, 9]],
      [3, [3, 7, 10, 14]],
      [0, [0, 3, 7, 10]],
    ],
    kick: FOUR,
    clap: TWO_FOUR,
    hat: "xXxXxXxXxXxXxXxX",
    open: "..x...x...x...x.",
    bass: "r.o.r.o.r.o.r.o.",
    lead: "..5.6...5...4.6.",
    bassWave: "square",
    bassCut: 520,
    leadWave: "sawtooth",
    leadCut: 2200,
    leadDecay: 0.12,
    pad: 0.45,
    swing: 0.05,
    kickTone: 150,
  },
  "night-bus": {
    id: "night-bus",
    bars: [
      [0, [0, 3, 7]],
      [0, [0, 3, 7]],
      [1, [1, 5, 8]],
      [0, [0, 3, 7]],
    ],
    kick: FOUR,
    clap: TWO_FOUR,
    hat: "..x...x...x...x.",
    open: "..X...X...X...X.",
    bass: ".rr..rr..rr..rf.",
    lead: "0.04.0.10.4.0.21",
    bassWave: "sawtooth",
    bassCut: 340,
    leadWave: "sawtooth",
    leadCut: 900,
    leadDecay: 0.1,
    pad: 0.25,
    swing: 0,
    kickTone: 175,
  },
};

/** Which parts play in each section (a level for each, 0 for out). */
export interface Layers {
  kick: number;
  clap: number;
  hat: number;
  open: number;
  bass: number;
  pad: number;
  lead: number;
}

export const LAYERS: Record<Section, Layers> = {
  intro: { kick: 0.9, clap: 0, hat: 0.8, open: 0, bass: 0.7, pad: 0, lead: 0 },
  groove: { kick: 1, clap: 1, hat: 1, open: 1, bass: 1, pad: 0.8, lead: 0 },
  full: { kick: 1, clap: 1, hat: 1, open: 1, bass: 1, pad: 1, lead: 1 },
  break: { kick: 0, clap: 0, hat: 0.4, open: 0, bass: 0, pad: 1, lead: 0.8 },
  rise: { kick: 1, clap: 1, hat: 1, open: 0.6, bass: 0.9, pad: 0.8, lead: 0.6 },
  build: { kick: 0, clap: 0, hat: 0.6, open: 0, bass: 0, pad: 0.9, lead: 0.9 },
  drop: { kick: 1.15, clap: 1, hat: 1, open: 1, bass: 1.1, pad: 1, lead: 1 },
};

/** A step's hit strength from a pattern: 0 rest, 0.7 hit, 1 accent. */
export const hitAt = (pattern: string, step: number) => {
  const c = pattern[step % 16];
  return c === "X" ? 1 : c === "x" ? 0.7 : 0;
};

/** The pitch (MIDI) of a bass step, or null for a rest. A2 (45) is the home note. */
export function bassNote(def: TrackDef, bar: number, step: number): number | null {
  const c = def.bass[step % 16];
  const [root] = def.bars[bar % def.bars.length]!;
  const base = 45 + fold(root, -5);
  if (c === "r") return base;
  if (c === "o") return base + 12;
  if (c === "f") return base + 7;
  return null;
}

/** The pitch (MIDI) of a lead step, or null for a rest. Chord notes are voiced up from A4 (69). */
export function leadNote(def: TrackDef, bar: number, step: number): number | null {
  const c = def.lead[step % 16];
  if (!c || c === ".") return null;
  const n = Number(c);
  const tones = chordVoicing(def, bar, 69);
  return tones[n % 4 % tones.length]! + (n >= 4 ? 12 : 0);
}

/** The bar's chord voiced close above `bottom` (MIDI), lowest first. */
export function chordVoicing(def: TrackDef, bar: number, bottom = 57): number[] {
  const [, chord] = def.bars[bar % def.bars.length]!;
  return chord.map((c) => bottom + fold(c, 0)).sort((a, b) => a - b);
}

/** Bring a number of semitones into [lo, lo + 12) by octaves. */
function fold(semi: number, lo: number) {
  return lo + ((((semi - lo) % 12) + 12) % 12);
}

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
