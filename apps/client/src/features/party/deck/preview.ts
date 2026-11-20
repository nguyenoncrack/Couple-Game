import { cueFor, DEFAULT_DECK, deckBeat, trackPosition, type Deck, type DeckTrackId, type MixStyle } from "@cg/shared";
import { create } from "zustand";
import { DeckEngine } from "./deckEngine";

/**
 * Rehearsal, just for you: a second, private deck that plays a record from its start point, or a whole transition
 * between any two records of the set from a few seconds before it, while the live mix carries on (turned down a
 * little, only for you). Nothing is sent to the house; your partner hears the party as usual.
 */

export interface PreviewPlan {
  /** The incoming record and where it comes in from (track beats). */
  into: DeckTrackId;
  inAt: number;
  /** For a transition: the outgoing record, where it starts fading (track beats), the style and the length. */
  out?: DeckTrackId;
  at?: number;
  style?: MixStyle;
  bars?: number;
}

interface PreviewState {
  /** What's playing: a label, the plan, the private deck, and when it stops (performance.now() ms). */
  on: { key: string; label: string; plan: PreviewPlan; deck: Deck; until: number } | null;
}

export const usePreview = create<PreviewState>(() => ({ on: null }));

/** How much of the outgoing record you hear before the transition starts, in beats. */
export const LEAD_BEATS = 16;
/** How long a cue preview plays, in beats, and how long you hear after a transition ends. */
const CUE_BEATS = 32;
const TAIL_BEATS = 8;
/** The live mix while you preview. */
const DUCK = 0.3;

let engine: DeckEngine | null = null;
let live: DeckEngine | null = null;
let timer = 0;

const clock = () => performance.now();

/** The private deck for a plan: the outgoing record on A, the incoming on B, anchored now at the live tempo. */
export function previewDeck(shared: Deck, plan: PreviewPlan, t: number): Deck {
  const base: Deck = { ...DEFAULT_DECK, bpm: shared.bpm, playing: true, t, beat: 0, a: null, b: null, mix: null, drop: null };
  if (plan.at === undefined || !plan.out) {
    // the incoming record on its own, from its start point
    return { ...base, b: plan.into, xfade: 1, cueB: cueFor(plan.into, 0, plan.inAt) };
  }
  const start = LEAD_BEATS;
  return {
    ...base,
    a: plan.out,
    b: plan.into,
    xfade: 0,
    cueA: cueFor(plan.out, 0, Math.max(0, plan.at - start)),
    // the incoming record waits at its start point until the transition starts
    cueB: start - plan.inAt,
    waitB: start,
    mix: { style: plan.style ?? "blend", from: 0, to: 1, start, beats: (plan.bars ?? 8) * 4, at: plan.at, inAt: plan.inAt },
  };
}

/** Play a preview (stopping one already playing). `key` says which one it is, so its button can show Stop. */
export function startPreview(key: string, label: string, liveEngine: DeckEngine, shared: Deck, plan: PreviewPlan, volume: number) {
  stopPreview();
  live = liveEngine;
  engine = new DeckEngine(clock, liveEngine);
  if (!engine.start()) {
    engine = null;
    return;
  }
  engine.setOutput(volume, 1);
  const t = clock();
  // (a moment's grace, so a recording that's already decoded starts with its first beat)
  const deck = previewDeck(shared, plan, t + 150);
  engine.follow(deck);
  live.setDuck(DUCK);
  const beats = plan.at === undefined ? CUE_BEATS : LEAD_BEATS + (plan.bars ?? 8) * 4 + TAIL_BEATS;
  const ms = (beats * 60_000) / shared.bpm + 150;
  usePreview.setState({ on: { key, label, plan, deck, until: t + ms } });
  timer = window.setTimeout(stopPreview, ms);
}

export function stopPreview() {
  window.clearTimeout(timer);
  engine?.stop();
  engine = null;
  live?.setDuck(1);
  live = null;
  if (usePreview.getState().on) usePreview.setState({ on: null });
}

/** Where the preview has got to in a record (as the outgoing or the incoming one), or null when it isn't playing it. */
export function previewPosition(role: "out" | "into", id: DeckTrackId | null): number | null {
  const on = usePreview.getState().on;
  const side = role === "out" ? "a" : "b";
  if (!on || !id || on.deck[side] !== id) return null;
  return trackPosition(on.deck, side, deckBeat(on.deck, clock()));
}

// (a handle for poking at it from the browser's console while developing)
if (import.meta.env.DEV) Object.assign(window, { __preview: { state: usePreview, engine: () => engine } });
