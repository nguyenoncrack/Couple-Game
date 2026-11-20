import { DEFAULT_BPM, MIX_BARS, MIX_STYLES, type DeckSide, type MixStyle } from "@cg/shared";
import { preciseClock } from "../deckTime";
import type { Analysis } from "./analyze";

/**
 * Suggested transitions: when, on the record on air, to start going over, where the other record should come in
 * from, in what style and over how long, and why.
 *
 * With a steady beat on both records the times sit on bar lines (the outgoing record's 8-bar phrases, the incoming
 * one's downbeats), so the beats land together, and the length is kept short enough that two records at slightly
 * different tempos don't drift apart. Without one, the times are only as good as the loudness says, so they're
 * marked approximate and the transition is a fade of so many seconds.
 */

export interface Suggestion {
  /** A key for the list. */
  id: string;
  out: DeckSide;
  into: DeckSide;
  /** Where the outgoing record starts fading, and where the incoming one comes in from (track beats). */
  at: number;
  inAt: number;
  style: MixStyle;
  bars: number;
  /** How long it takes at the deck's tempo (seconds). */
  seconds: number;
  approximate: boolean;
  /** The one-line plan, and why. */
  text: string;
  reason: string;
}

export interface SuggestInput {
  out: DeckSide;
  /** Where the outgoing record is now (track beats). */
  outPos: number;
  /** The deck's tempo. */
  bpm: number;
  outA: Analysis;
  inA: Analysis;
  /** The incoming record's saved cues (track beats). */
  inCues: readonly number[];
  /** What to call the two records ("Track 4"); the decks ("Deck A") by default. */
  names?: { out: string; into: string };
}

const toBeats = (s: number) => (s * DEFAULT_BPM) / 60;
const toSeconds = (beats: number) => (beats * 60) / DEFAULT_BPM;
/** How long a transition of `bars` (deck bars) takes in a record's own time (seconds). */
const spanOf = (bars: number) => toSeconds(bars * 4);
const upper = (s: DeckSide) => s.toUpperCase();
const styleWord = (s: MixStyle) => (MIX_STYLES.find((m) => m.id === s)?.name ?? s).toLowerCase();

/** A record's average energy (0 to 1) from one time to another. */
function energy(a: Analysis, from: number, to: number): number {
  const i = Math.max(0, Math.floor(from));
  const j = Math.min(a.energy.length, Math.max(i + 1, Math.ceil(to)));
  let sum = 0;
  for (let k = i; k < j; k++) sum += a.energy[k]!;
  return j > i ? sum / (j - i) / 255 : 0;
}

/** How far apart two tempos are, as a fraction, allowing for one being double the other. */
export function tempoGap(x: number, y: number): number {
  const r = x / y;
  const octave = 2 ** Math.round(Math.log2(r));
  return Math.abs(r / octave - 1);
}

/** The longest transition (in bars) two records at these tempos can hold before their beats drift a third of a beat. */
export function longestTogether(gap: number): number {
  let best: number = MIX_BARS[0];
  for (const bars of MIX_BARS) if (bars * 4 * gap <= 0.34) best = bars;
  return best;
}

/** The record's bar lines (seconds) from `from` to `to`, every `every` beats of its own. */
function grid(a: Analysis, every: number, from: number, to: number): number[] {
  const step = (every * 60) / a.bpm;
  const out: number[] = [];
  for (let t = a.downbeat + Math.ceil((from - a.downbeat) / step - 1e-9) * step; t <= to; t += step) out.push(t);
  return out;
}

/** The nearest downbeat at or before `t` (or the first one, if there isn't one before). */
function downbeatBefore(a: Analysis, t: number): number {
  const bar = (4 * 60) / a.bpm;
  const k = Math.floor((t - a.downbeat) / bar + 1e-9);
  const at = a.downbeat + k * bar;
  return at >= 0 ? at : a.downbeat + Math.ceil(-a.downbeat / bar) * bar;
}

/** Where a record's energy rises most (its drop, or where it gets going), in its first part; null if it never does. */
export function findLift(a: Analysis): { at: number; lift: number } | null {
  const end = Math.min(a.duration * 0.6, 180);
  let best: { at: number; lift: number } | null = null;
  for (let t = 6; t < end; t++) {
    const lift = energy(a, t, t + 6) - energy(a, t - 6, t);
    if (!best || lift > best.lift) best = { at: t, lift };
  }
  return best && best.lift > 0.12 ? best : null;
}

/** Where a record's outro starts (its energy stays low from there to the end), or null. */
function findOutro(a: Analysis): number | null {
  const typical = energy(a, 0, a.duration);
  for (let t = Math.floor(a.duration * 0.55); t < a.duration - 8; t++) {
    if (energy(a, t, a.duration) < typical * 0.72 && energy(a, t, t + 8) < typical * 0.8) return t;
  }
  return null;
}

/** Up to three transitions from the deck on air to the other one. */
export function suggestMixes(input: SuggestInput): Suggestion[] {
  const { out, outA, inA, bpm } = input;
  const into: DeckSide = out === "a" ? "b" : "a";
  const outName = input.names?.out ?? `Deck ${upper(out)}`;
  const inName = input.names?.into ?? `Deck ${upper(into)}`;
  const outShort = input.names?.out ?? upper(out);
  const inShort = input.names?.into ?? upper(into);
  const approximate = !outA.reliable || !inA.reliable;
  const gap = tempoGap(outA.bpm, inA.bpm);
  const together = longestTogether(gap);
  const now = toSeconds(input.outPos);
  // (a moment to get ready, at the deck's speed)
  const earliest = now + (8 * bpm) / DEFAULT_BPM;

  /** The style and length for each kind of moment. */
  const plan = (kind: "next" | "dip" | "outro"): { style: MixStyle; bars: number } => {
    if (approximate) {
      // a fade, about 8, 12 or 16 seconds at this tempo
      const want = kind === "next" ? 12 : kind === "dip" ? 8 : 16;
      const bars = MIX_BARS.reduce((b, n) => (Math.abs((n * 240) / bpm - want) < Math.abs((b * 240) / bpm - want) ? n : b), MIX_BARS[0] as number);
      return { style: "blend", bars };
    }
    if (together >= 8) return kind === "next" ? { style: "bass", bars: 8 } : kind === "dip" ? { style: "filter", bars: 8 } : { style: "blend", bars: Math.min(16, together) };
    if (together >= 4) return kind === "next" ? { style: "bass", bars: 4 } : kind === "dip" ? { style: "filter", bars: 4 } : { style: "echo", bars: 2 };
    return kind === "next" ? { style: "echo", bars: 2 } : kind === "dip" ? { style: "cut", bars: 1 } : { style: "echo", bars: 1 };
  };

  /** Points on the outgoing record a transition can start from: its phrases (or, without a grid, every second). */
  const points = (bars: number): number[] => {
    const latest = outA.duration - spanOf(bars) - 1;
    if (latest < earliest) return [];
    if (approximate) {
      const out: number[] = [];
      for (let t = Math.ceil(earliest); t <= latest; t++) out.push(t);
      return out;
    }
    const phrases = grid(outA, 32, earliest, latest);
    return phrases.length >= 2 ? phrases : grid(outA, 16, earliest, latest);
  };

  /** Where the incoming record comes in, so its lift lands as the transition ends (or from its start). */
  const lift = findLift(inA);
  const entry = (bars: number, cue?: number): { inAt: number; why: string } => {
    if (cue !== undefined) return { inAt: toSeconds(cue), why: "from your saved cue" };
    if (lift) {
      const t = lift.at - spanOf(bars);
      if (t >= 0) return { inAt: approximate ? Math.max(0, Math.round(t)) : downbeatBefore(inA, t), why: `${inShort}'s drop lands as it ends` };
    }
    return { inAt: approximate ? 0 : downbeatBefore(inA, 0), why: `${inShort} comes in from its top` };
  };

  const tempo = approximate
    ? "The beat grid isn't sure, so it's a fade timed in seconds"
    : gap < 0.01
      ? `Both near ${Math.round(outA.bpm)} BPM, so the beats line up`
      : together >= 8
        ? `${Math.round(outA.bpm)} and ${Math.round(inA.bpm)} BPM stay together for ${together} bars`
        : `${Math.round(outA.bpm)} vs ${Math.round(inA.bpm)} BPM, so it's kept short`;

  const picks: { kind: "next" | "dip" | "outro"; at: number; where: string }[] = [];
  const taken = (t: number) => picks.some((p) => Math.abs(p.at - t) < 8);

  // the next phrase
  {
    const p = points(plan("next").bars);
    if (p.length) picks.push({ kind: "next", at: p[0]!, where: approximate ? `Soon on ${outShort}` : `The next 8-bar phrase on ${outShort}` });
  }
  // the biggest drop in energy ahead (a breakdown is a natural way out)
  {
    let best: { at: number; drop: number } | null = null;
    for (const t of points(plan("dip").bars)) {
      const drop = energy(outA, t - 8, t) - energy(outA, t, t + 8);
      if (!taken(t) && (!best || drop > best.drop)) best = { at: t, drop };
    }
    if (best && best.drop > 0.08) picks.push({ kind: "dip", at: best.at, where: `${outShort} drops into a breakdown here` });
  }
  // the outro (or as late as it can be)
  {
    const p = points(plan("outro").bars);
    const outro = findOutro(outA);
    let at: number | undefined;
    if (outro !== null) at = p.find((t) => t >= outro - 1) ?? p[p.length - 1];
    else at = p[p.length - 1];
    if (at !== undefined && !taken(at)) picks.push({ kind: "outro", at, where: outro !== null ? `${outShort}'s outro` : `Before ${outShort} runs out` });
  }

  const firstCue = input.inCues.find((c) => c < toBeats(inA.duration) - 1);
  // (the one from your own cue is the last found; then they're listed in the order they'd happen)
  const chosen = picks.slice(0, 3).map((p, i) => ({ ...p, cue: i === picks.length - 1 && picks.length > 1 ? firstCue : undefined }));
  chosen.sort((x, y) => x.at - y.at);
  return chosen.map((p) => {
    const { style, bars } = plan(p.kind);
    // the last one starts the incoming record from your own cue, if it has one
    const { inAt, why } = entry(bars, p.cue);
    const at = toBeats(p.at);
    const inBeats = toBeats(inAt);
    const seconds = (bars * 4 * 60) / bpm;
    const text = approximate
      ? `At about ${preciseClock(at)} on ${outName}, fade in ${inName} from ${preciseClock(inBeats)} over about ${Math.round(seconds)} s.`
      : `At ${preciseClock(at)} on ${outName}, bring in ${inName} at ${preciseClock(inBeats)} with ${bars === 8 ? "an" : "a"} ${bars}-bar ${styleWord(style)}.`;
    return {
      id: `${p.kind}-${Math.round(at * 10)}-${Math.round(inBeats * 10)}-${style}-${bars}`,
      out,
      into,
      at: Math.round(at * 1000) / 1000,
      inAt: Math.round(inBeats * 1000) / 1000,
      style,
      bars,
      seconds,
      approximate,
      text,
      reason: `${p.where}; ${why}. ${tempo}.`,
    };
  });
}
