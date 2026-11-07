import type { Blueprint } from "../blueprint";
import { catalog as defaultCatalog, type Catalog } from "../catalog";
import type { LifeState } from "../life/state";
import { cleanText, emptyFort, isPattern, NAME_MAX, SIGN_MAX, type FortCmd, type FortReject, type FortState } from "./definitions";
import { findFrame, hasFairyLights } from "./kit";

/**
 * A player changes one of the house's forts: its blanket pattern, its name and sign, or the fairy lights. It's the
 * house's, not an order to anyone's character. Both players can; the server checks the fort is there and, for the
 * lights, that some are hung on it.
 */

/** A fort's settings as they stand (the defaults, if it's never been touched). */
export const fortOf = (state: Pick<LifeState, "forts">, id: string): FortState => state.forts?.[id] ?? emptyFort();

export function applyFort(state: LifeState, bp: Blueprint, id: string, cmd: FortCmd, cat: Catalog = defaultCatalog): { reject: FortReject | null; changed: boolean } {
  const found = findFrame(bp, id, cat);
  if (!found) return { reject: "no-fort", changed: false };
  const now = fortOf(state, id);
  const next: FortState = { ...now };
  if (cmd.pattern && isPattern(cmd.pattern)) next.pattern = cmd.pattern;
  if (cmd.name !== undefined) next.name = cleanText(cmd.name, NAME_MAX);
  if (cmd.sign !== undefined) next.sign = cleanText(cmd.sign, SIGN_MAX);
  if (cmd.lit !== undefined) {
    if (cmd.lit && !hasFairyLights(bp.levels[found.level]!, found.o, cat)) return { reject: "no-lights", changed: false };
    next.lit = cmd.lit;
  }
  if (next.name === now.name && next.sign === now.sign && next.pattern === now.pattern && next.lit === now.lit) return { reject: null, changed: false };
  (state.forts ??= {})[id] = next;
  return { reject: null, changed: true };
}

/** Settings of forts that are gone are kept for a little while, so Undo (or buying one back) brings its name back. */
const GONE_KEPT = 8;

/**
 * The house changed: a fort whose fairy lights were taken down (or that's gone) isn't lit any more, and the settings
 * of forts long gone are let go. True if anything changed.
 */
export function tidyForts(state: LifeState, bp: Blueprint, cat: Catalog = defaultCatalog): boolean {
  if (!state.forts) return false;
  let changed = false;
  const gone: string[] = [];
  for (const [id, fort] of Object.entries(state.forts)) {
    const found = findFrame(bp, id, cat);
    if (!found) gone.push(id);
    if (fort.lit && (!found || !hasFairyLights(bp.levels[found.level]!, found.o, cat))) {
      state.forts[id] = { ...fort, lit: false };
      changed = true;
    }
  }
  for (const id of gone.slice(0, Math.max(0, gone.length - GONE_KEPT))) {
    delete state.forts[id];
    changed = true;
  }
  return changed;
}

/** What gets written down with the house: only forts that differ from the defaults. */
export function savedForts(forts: Record<string, FortState> | undefined): Record<string, FortState> | undefined {
  if (!forts) return undefined;
  const out: Record<string, FortState> = {};
  for (const [id, f] of Object.entries(forts)) out[id] = { name: f.name, sign: f.sign, pattern: f.pattern, lit: f.lit };
  return Object.keys(out).length ? out : undefined;
}

/** Forts as read back from a save: anything that doesn't look right is dropped or put right, never trusted. */
export function restoredForts(raw: unknown): Record<string, FortState> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, FortState> = {};
  for (const [id, v] of Object.entries(raw as Record<string, Partial<FortState>>)) {
    if (!v || typeof v !== "object") continue;
    out[id] = {
      name: cleanText(typeof v.name === "string" ? v.name : "", NAME_MAX),
      sign: cleanText(typeof v.sign === "string" ? v.sign : "", SIGN_MAX),
      pattern: isPattern(v.pattern) ? v.pattern : emptyFort().pattern,
      lit: v.lit === true,
    };
  }
  return Object.keys(out).length ? out : undefined;
}
