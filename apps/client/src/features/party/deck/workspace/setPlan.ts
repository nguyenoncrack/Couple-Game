import { deckTrack, isRecording, MAX_SET_STEPS, mixDone, mixOut, mixQueued, trackBeats, type Deck, type DeckSide, type DeckTrackId, type SetStep } from "@cg/shared";
import type { Analysis } from "../analysis/analyze";
import { autoLink } from "../analysis/chain";

/**
 * The set list behind the DJ workspace: the shared set as the house sees it (the record on air, and what comes
 * before and after it), and the edits you can make to it. Every edit keeps the record on air where it is and works
 * out again only the links it changes, so those can be flagged for you to check before they play.
 */

export interface LiveList {
  steps: SetStep[];
  /** Where the record on air is in the list (null with nothing on the decks). */
  onAir: number | null;
  /** Where the house has the record on air (what an edit says it saw). */
  was: number;
  /** Whether the list is the house's set, or just the record on air on its own. */
  shared: boolean;
}

/** The deck on air once any finished transition is put away (as the house will see it on the next command). */
export function onAirSide(deck: Deck, beat: number): DeckSide {
  const m = deck.mix;
  const x = m && mixDone(m, beat) ? m.to : deck.xfade;
  return x < 0.5 ? "a" : "b";
}

/** The set list: the house's set if it's following the record on air, or that record on its own. */
export function liveList(deck: Deck, beat: number): LiveList {
  const side = onAirSide(deck, beat);
  const id = deck[side];
  const s = deck.set;
  if (s && id) {
    let step = s.step;
    // a transition that's over, and the set not moved on yet: the house moves it on before anything else
    const mixing = deck.mix && !mixDone(deck.mix, beat);
    if (!mixing && s.steps[step]?.next && s.steps[step + 1]?.track === id) step++;
    if (s.steps[step]?.track === id) return { steps: s.steps, onAir: step, was: step, shared: true };
  }
  if (id) return { steps: [{ track: id, from: deck[side === "a" ? "entryA" : "entryB"] ?? 0, cues: [] }], onAir: 0, was: 0, shared: false };
  return { steps: [], onAir: null, was: 0, shared: false };
}

/** A link's identity: the two records it joins (the same pair is the same transition, wherever it sits). */
export const pairKey = (steps: readonly SetStep[], i: number): string | null => (steps[i] && steps[i + 1] ? `${steps[i]!.track}>${steps[i + 1]!.track}` : null);

export interface EditContext {
  bpm: number;
  analysis: (id: DeckTrackId) => Analysis | null;
  onAir: number | null;
  /** Where the record on air is now, while it plays (a link from it has to come after this). */
  onAirPos: number | null;
}

export interface Edit {
  steps: SetStep[];
  onAir: number | null;
  /** The links worked out again (by the index of their outgoing record). */
  relinked: number[];
}

/** Work out the link from record `i` to the next one again (in place). Links before the record on air are history. */
function relink(list: SetStep[], i: number, ctx: EditContext): boolean {
  const cur = list[i];
  const next = list[i + 1];
  if (!cur || !next || (ctx.onAir !== null && i < ctx.onAir)) return false;
  const from = i === ctx.onAir && ctx.onAirPos !== null ? ctx.onAirPos : cur.from;
  const l = autoLink(cur.track, from, next.track, ctx.bpm, ctx.analysis(cur.track), ctx.analysis(next.track));
  list[i] = { ...cur, next: { at: l.at, style: l.style, bars: l.bars } };
  // (the record on air has already come in)
  if (i + 1 !== ctx.onAir) list[i + 1] = { ...next, from: l.inFrom };
  return true;
}

const tidy = (list: SetStep[]) => {
  const last = list[list.length - 1];
  if (last?.next) list[list.length - 1] = { track: last.track, from: last.from, cues: last.cues };
  return list;
};

/** Add records to the end, linking each to the one before. */
export function addSongs(steps: readonly SetStep[], ids: readonly DeckTrackId[], ctx: EditContext): Edit {
  const list = [...steps];
  const room = MAX_SET_STEPS - list.length;
  const start = list.length;
  for (const id of ids.slice(0, Math.max(0, room))) list.push({ track: id, from: 0, cues: [] });
  const relinked: number[] = [];
  for (let i = Math.max(0, start - 1); i < list.length - 1; i++) if (relink(list, i, ctx)) relinked.push(i);
  return { steps: tidy(list), onAir: ctx.onAir ?? (list.length ? 0 : null), relinked };
}

/** Whether row `i` can move by one (never across the record on air, which stays where it is). */
export function canMove(steps: readonly SetStep[], i: number, by: -1 | 1, onAir: number | null): boolean {
  const j = i + by;
  return j >= 0 && j < steps.length && i !== onAir && j !== onAir;
}

/** Move a record one place up or down; the links around both records are worked out again. */
export function moveSong(steps: readonly SetStep[], i: number, by: -1 | 1, ctx: EditContext): Edit {
  if (!canMove(steps, i, by, ctx.onAir)) return { steps: [...steps], onAir: ctx.onAir, relinked: [] };
  const j = i + by;
  const list = steps.map((s) => ({ ...s }));
  [list[i], list[j]] = [list[j]!, list[i]!];
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  // (the last record has no link of its own)
  tidy(list);
  const relinked = [lo - 1, lo, hi].filter((k) => k >= 0 && k < list.length - 1 && relink(list, k, ctx));
  return { steps: tidy(list), onAir: ctx.onAir, relinked };
}

/** Take a record out (not the one on air): the one before it now links straight to the one after. */
export function removeSong(steps: readonly SetStep[], i: number, ctx: EditContext): Edit {
  if (i === ctx.onAir || !steps[i]) return { steps: [...steps], onAir: ctx.onAir, relinked: [] };
  const list = steps.filter((_, k) => k !== i);
  const onAir = ctx.onAir !== null && i < ctx.onAir ? ctx.onAir - 1 : ctx.onAir;
  const relinked = i > 0 && i < list.length && relink(list, i - 1, { ...ctx, onAir }) ? [i - 1] : [];
  return { steps: tidy(list), onAir, relinked };
}

/**
 * Work transitions out again from the records' beats and energy, as a suggested mix would: one (the link out of
 * record `i`), or every one from the record on air to the end (`null`). Links already played are left alone.
 */
export function autoLinks(steps: readonly SetStep[], i: number | null, ctx: EditContext): Edit {
  const list = steps.map((s) => ({ ...s }));
  const first = Math.max(0, ctx.onAir ?? 0);
  const which = i === null ? Array.from({ length: Math.max(0, list.length - 1 - first) }, (_, k) => first + k) : [i];
  const relinked = which.filter((k) => k < list.length - 1 && relink(list, k, ctx));
  return { steps: tidy(list), onAir: ctx.onAir, relinked };
}

/** What's wrong with a link, if anything: inside its record, and after where that record starts (or is now). */
export function linkProblem(step: SetStep, startsAt: number): string | null {
  if (!step.next) return null;
  if (step.next.at >= trackBeats(step.track)) return "past the end of the record";
  if (step.next.at <= startsAt) return "already gone by";
  return null;
}

/** The record's artist (a recording) or kind (a built-in one), for the list. */
export function artistOf(id: DeckTrackId): string {
  const t = deckTrack(id);
  return isRecording(id) ? t.style : `Built-in · ${t.style}`;
}

/** Whether two lists are the same set (allowing for the house rounding places to its grid). */
export function sameSteps(a: readonly SetStep[] | undefined, b: readonly SetStep[]): boolean {
  if (!a || a.length !== b.length) return false;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.26;
  return b.every((s, i) => {
    const t = a[i]!;
    if (t.track !== s.track || !near(t.from, s.from)) return false;
    if (!s.next || i === b.length - 1) return true;
    return Boolean(t.next) && t.next!.style === s.next.style && t.next!.bars === s.next.bars && near(t.next!.at, s.next.at);
  });
}

/** How far short of a queued set transition a jump on its record stops (a bar). */
export const SEEK_MARGIN = 4;

/**
 * Where a jump on a deck may go. Jumping the record on air past the point where the set's next transition starts
 * would call that transition off, and with it the rest of the set, so a jump stops a bar short of it instead (Mix now
 * goes on to the next record). Anything else goes where it's asked.
 */
export function safeSeek(d: Deck, side: DeckSide, pos: number, beat: number): number {
  const m = d.mix;
  const linked = Boolean(d.set?.steps[d.set.step]?.next);
  if (!m || !linked || !mixQueued(m, beat) || m.at === undefined || mixOut(m) !== side) return pos;
  return Math.min(pos, Math.max(0, m.at - SEEK_MARGIN));
}
