import { trackBeats, type DeckTrackId, type MixStyle, type SetStep } from "@cg/shared";
import type { Analysis } from "./analyze";
import { suggestMixes } from "./suggest";

/**
 * Linking records into a chain: one hands over to the next, that one to the one after, and so on. Each link is
 * worked out like a suggested transition: as late as sounds good in the outgoing record (its outro, so most of it
 * plays), with the incoming record coming in where its drop lands as the transition ends.
 */

export interface Link {
  at: number;
  style: MixStyle;
  bars: number;
  /** Where the incoming record starts (track beats). */
  inFrom: number;
  /** Worked out from the records' beats, or a plain fade near the end (no analysis yet, or nothing fits). */
  how: "beats" | "approximate" | "fallback";
}

/**
 * A link from one record to the next. `outFrom` is where the outgoing record starts (or where it is now, if it's on
 * air), so the link always comes after it.
 */
export function autoLink(outId: DeckTrackId, outFrom: number, inId: DeckTrackId, bpm: number, outA: Analysis | null, inA: Analysis | null): Link {
  if (outA && inA) {
    const list = suggestMixes({ out: "a", outPos: outFrom, bpm, outA, inA, inCues: [] });
    // the latest one: the outgoing record plays (nearly) all the way through
    const s = list[list.length - 1];
    if (s) return { at: s.at, style: s.style, bars: s.bars, inFrom: s.inAt, how: s.approximate ? "approximate" : "beats" };
  }
  // no analysis (or nothing fits): an 8-bar blend that finishes a bar before the end
  const len = trackBeats(outId);
  const at = Math.max(Math.min(outFrom + 4, len - 1), len - 36);
  return { at: Math.round(at * 1000) / 1000, style: "blend", bars: 8, inFrom: 0, how: "fallback" };
}

/** Link every record in a chain to the next (keeping the first one's start). */
export function linkAll(steps: SetStep[], bpm: number, analysis: (id: DeckTrackId) => Analysis | null, firstFrom?: number): SetStep[] {
  const out = steps.map((s) => ({ ...s }));
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i]!;
    const next = out[i + 1]!;
    const link = autoLink(cur.track, i === 0 && firstFrom !== undefined ? firstFrom : cur.from, next.track, bpm, analysis(cur.track), analysis(next.track));
    cur.next = { at: link.at, style: link.style, bars: link.bars };
    next.from = link.inFrom;
  }
  delete out[out.length - 1]?.next;
  return out;
}

/** What's wrong with a link, if anything: its time must be inside the record and after where it starts. */
export function linkProblem(step: SetStep, startsAt: number): string | null {
  if (!step.next) return null;
  const len = trackBeats(step.track);
  if (step.next.at >= len) return "past the end of the record";
  if (step.next.at <= startsAt) return "before the record gets there";
  return null;
}
