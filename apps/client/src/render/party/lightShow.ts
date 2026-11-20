import { DEFAULT_BPM, isRecording, mixAt, sectionAt, sectionOf, trackPosition, type Deck, type DeckSide, type DeckTrackId, type Section } from "@cg/shared";

/**
 * The lights follow the music: what the record on air is doing right now, and the light show worked out from it.
 *
 * `grooveOf` reads the deck: where the beat and the bar are, and how hard the music is going. A built-in record knows
 * its own sections (and the Drop pad takes over for its build and drop). A recording that has been listened to brings
 * its own beat grid and its loudness, second by second, so the lights land on its real beats and calm down in its
 * quiet parts. Without that, the deck's beat and a middling energy stand in.
 *
 * `LightShow` turns that into a few numbers the lights read every frame: a flash on each beat (stronger on the first
 * beat of a bar, never more than one a beat, so at most a little over two a second), the energy (smoothed), the bar
 * count (patterns step on it) and a lift: one burst when the music comes back in hard (a drop). Steady light, or a
 * device that asks for less motion, gets none of the flashing or stepping: a calm, even glow.
 */

export interface Groove {
  /** Beats on the record's own grid (fractional), and which beat of its bar (0 to 4). */
  beat: number;
  barBeat: number;
  /** Whole bars since the record's first downbeat. */
  bar: number;
  /** 0 to 1: how hard the music is going. */
  energy: number;
  /** A built-in record's section, or a drop's; null for a recording outside a drop. */
  section: Section | null;
}

/** How hard each part of a built-in record goes. */
export const SECTION_ENERGY: Record<Section, number> = { intro: 0.5, groove: 0.7, full: 0.9, break: 0.2, rise: 0.55, build: 0.75, drop: 1 };

/** The bits of a record's analysis the lights use (times in seconds at the record's own speed). */
export interface GrooveAnalysis {
  bpm: number;
  downbeat: number;
  reliable: boolean;
  energy: Uint8Array;
}

/** The deck the audience hears most at `beat`: the one the crossfader (or a transition under way) favours. */
export function loudSide(d: Deck, beat: number): DeckSide {
  return mixAt(d, beat).xfade < 0.5 ? "a" : "b";
}

const mod = (x: number, n: number) => ((x % n) + n) % n;

/** What the music on the decks is doing at `beat`, or null while nothing plays. */
export function grooveOf(d: Deck | undefined, beat: number, analysisOf: (id: DeckTrackId) => GrooveAnalysis | null, side?: DeckSide): Groove | null {
  if (!d?.playing) return null;
  side ??= loudSide(d, beat);
  const id = d[side];
  const local = trackPosition(d, side, beat);
  if (!id || local === null) return null;
  const dropping = sectionAt(beat, d.drop);
  const drop = dropping === "build" || dropping === "drop" ? dropping : null;
  if (!isRecording(id)) {
    // a built-in record's beats are the deck's, and it knows its sections
    const section = sectionOf(local, beat, d.drop);
    return { beat: local, barBeat: mod(local, 4), bar: Math.floor(local / 4), energy: SECTION_ENERGY[section], section };
  }
  const a = analysisOf(id);
  const seconds = (local * 60) / DEFAULT_BPM;
  if (!a) return { beat: local, barBeat: mod(local, 4), bar: Math.floor(local / 4), energy: drop ? SECTION_ENERGY[drop] : 0.7, section: drop };
  // the record's own beats, if its grid can be trusted (it plays at the deck's speed, so its own time is right)
  const own = a.reliable ? ((seconds - a.downbeat) * a.bpm) / 60 : local;
  const i = Math.max(0, Math.min(a.energy.length - 1, Math.floor(seconds)));
  const loud = (a.energy[i] ?? 0) / 255;
  // its loudness, spread out a little so the quiet parts read as quiet and the loud ones as full on
  const energy = drop ? SECTION_ENERGY[drop] : Math.min(1, Math.max(0, (loud - 0.25) / 0.65));
  return { beat: own, barBeat: mod(own, 4), bar: Math.floor(own / 4), energy, section: drop };
}

export interface ShowFrame {
  /** A track is driving this frame and motion is enabled. */
  active: boolean;
  /** 0 to 1: a flash on the beat that dies away before the next. */
  flash: number;
  /** 0 to 1, smoothed. */
  energy: number;
  /** Whole bars, for patterns that step each bar (0 when steady). */
  bar: number;
  /** Which beat of the bar (0 to 4), for things that move to a new place each bar. */
  barBeat: number;
  /** 0 to 1: a burst when the music comes back in hard, fading over a second and a half. */
  lift: number;
}

export const CALM: ShowFrame = { active: false, flash: 0, energy: 0.6, bar: 0, barBeat: 0, lift: 0 };

const ease = (from: number, to: number, dt: number, seconds: number) => from + (to - from) * (1 - Math.exp(-dt / seconds));

export class LightShow {
  energy = CALM.energy;
  /** The energy over the last few seconds, to tell a sudden lift from a steady loud part. */
  private slow = CALM.energy;
  private lift = 0;
  private section: Section | null = null;

  step(g: Groove | null, dt: number, steady: boolean): ShowFrame {
    if (steady || !g) {
      this.energy = ease(this.energy, CALM.energy, dt, 0.8);
      this.slow = this.energy;
      this.lift = 0;
      this.section = null;
      return { ...CALM, energy: this.energy };
    }
    this.energy = ease(this.energy, g.energy, dt, g.energy > this.energy ? 0.25 : 0.9);
    this.slow = ease(this.slow, g.energy, dt, 4);
    // a burst when the music comes back in: into a drop, or back from a break, or a recording getting much louder fast
    const into = g.section !== this.section && (g.section === "drop" || ((this.section === "break" || this.section === "rise" || this.section === "build") && (g.section === "full" || g.section === "groove")));
    const surge = g.energy - this.slow > 0.3;
    if ((into || surge) && this.lift < 0.15) this.lift = 1;
    else this.lift = this.lift > dt / 1.5 ? this.lift - dt / 1.5 : 0;
    this.section = g.section;
    if (surge) this.slow = g.energy;
    // one flash a beat, harder on the bar's first beat; nothing while the kick is out
    const kick = g.section === "break" ? 0 : g.section === "build" ? 0.6 : 1;
    const f = g.beat - Math.floor(g.beat);
    const accent = g.barBeat < 1 ? 1 : 0.6;
    const flash = kick * accent * Math.exp(-f * 7) * (0.35 + 0.65 * this.energy);
    return { active: true, flash, energy: this.energy, bar: g.bar, barBeat: g.barBeat, lift: this.lift };
  }
}
