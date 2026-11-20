import type { Deck, MixStyle, PartyCmd } from "@cg/shared";
import { create } from "zustand";
import { partyCmd, useGame } from "../../../../state/game";

/**
 * The DJ workspace's own state on this screen: which pair of records you're working on, the transition you're
 * adjusting (not saved yet), which side panel is open, the links to check after a reorder, and how the last command
 * went. It lives outside the console, so closing a panel (or the console) leaves it where it was.
 */

export interface Draft {
  /** The pair it was made for (its index and records), so it's dropped if the list changes under it. */
  key: string;
  at: number;
  inAt: number;
  style: MixStyle;
  bars: number;
  /** The suggestion it came from, if any. */
  pick: string | null;
}

export type Panel = "fx" | "timing" | null;

export interface CommandStatus {
  id: number;
  text: string;
  state: "pending" | "done" | "failed";
}

interface Workspace {
  /** The link being worked on: from record `pair` to the next. */
  pair: number;
  /** The record selected in the list (one of the pair's two). */
  selected: number;
  draft: Draft | null;
  panel: Panel;
  /** Links (by the records they join) made by a reorder or removal that haven't been checked yet. */
  review: string[];
  status: CommandStatus | null;
  zoom: number;
  /** Centre the waveforms on the transition's points, not on the playheads. */
  onPoints: boolean;
}

export const useWorkspace = create<Workspace>(() => ({ pair: 0, selected: 0, draft: null, panel: null, review: [], status: null, zoom: 4, onPoints: true }));

export const draftKey = (pair: number, out: string, into: string) => `${pair}:${out}>${into}`;

/** Work on the link from record `i` to the next (and select the incoming record, whose start point it sets). */
export function focusPair(i: number) {
  useWorkspace.setState((s) => ({ pair: i, selected: i + 1, draft: s.pair === i ? s.draft : null }));
}

/** Select a record: the pair shown is the link into it (or, for the first record, the link out of it). */
export function selectRow(i: number) {
  const pair = Math.max(0, i - 1);
  useWorkspace.setState((s) => ({ selected: i, pair, draft: s.pair === pair ? s.draft : null }));
}

export const setDraft = (draft: Draft | null) => useWorkspace.setState({ draft });
export const setPanel = (panel: Panel) => useWorkspace.setState((s) => ({ panel: s.panel === panel ? null : panel }));
export const flagForReview = (keys: string[]) => useWorkspace.setState((s) => ({ review: [...new Set([...s.review, ...keys])] }));
export const markReviewed = (key: string | null) => key && useWorkspace.setState((s) => ({ review: s.review.filter((k) => k !== key) }));

let seq = 0;
const AFTER_MS = 4000;

/** Show a message about what you just did (with nothing sent to the house). */
export function say(text: string, state: CommandStatus["state"] = "done") {
  useWorkspace.setState({ status: { id: ++seq, text, state } });
}

/**
 * Send a deck command and report it: pending until the shared deck shows `landed`, then done, or failed if it
 * doesn't within a few seconds (the house turned it down, or it never got there).
 */
export function sendTracked(cmd: PartyCmd, text: { pending: string; done: string; failed: string }, landed: (deck: Deck) => boolean, then?: () => void) {
  const id = ++seq;
  useWorkspace.setState({ status: { id, text: text.pending, state: "pending" } });
  const finish = (state: "done" | "failed") => {
    unsubscribe();
    window.clearTimeout(timer);
    if (state === "done") then?.();
    if (useWorkspace.getState().status?.id === id) useWorkspace.setState({ status: { id, text: state === "done" ? text.done : text.failed, state } });
  };
  const check = () => {
    const deck = useGame.getState().life?.party?.deck;
    if (deck && landed(deck)) finish("done");
  };
  const unsubscribe = useGame.subscribe(check);
  const timer = window.setTimeout(() => finish("failed"), AFTER_MS);
  partyCmd(cmd);
}

/** Back to the start: leaving a house. */
export function resetWorkspace() {
  useWorkspace.setState({ pair: 0, selected: 0, draft: null, panel: null, review: [], status: null });
}

// (a handle for poking at it from the browser's console while developing)
if (import.meta.env.DEV) Object.assign(window, { __workspace: useWorkspace });
