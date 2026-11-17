import { MIX_BARS, MIX_STYLE_IDS, restoredSteps, type DeckSet, type MixStyle } from "@cg/shared";
import { create } from "zustand";

/** This player's own party settings and which page of the console is showing. Nothing here is shared. */

interface PartyUi {
  tab: "music" | "sound" | "sets" | "lights" | "guide";
  volume: number;
  muted: boolean;
  /** The music gets quieter the further your character is from the speakers (on by default). */
  fade: boolean;
  /** The transition the Mix pad starts, and this player's own saved transitions. */
  mixStyle: MixStyle;
  mixBars: number;
  presets: MixPreset[];
  /** This player's saved DJ sets (on this device). */
  sets: SavedSet[];
}

export interface SavedSet extends DeckSet {
  id: string;
  savedAt: number;
}

export interface MixPreset {
  name: string;
  style: MixStyle;
  bars: number;
}

/** Transitions everyone has: a long smooth one, a DJ's bass swap, an echo out, a filter fade and a quick cut. */
export const BUILT_IN_PRESETS: readonly MixPreset[] = [
  { name: "Smooth", style: "blend", bars: 8 },
  { name: "Bass swap", style: "bass", bars: 8 },
  { name: "Echo out", style: "echo", bars: 4 },
  { name: "Filter fade", style: "filter", bars: 8 },
  { name: "Quick cut", style: "cut", bars: 1 },
];
export const MAX_PRESETS = 6;
const MIX_KEY = "cg.party.mix";

const goodStyle = (v: unknown): v is MixStyle => MIX_STYLE_IDS.includes(v as MixStyle);
const goodBars = (v: unknown): v is number => (MIX_BARS as readonly number[]).includes(v as number);

function loadMix(): Pick<PartyUi, "mixStyle" | "mixBars" | "presets"> {
  const fallback = { mixStyle: "blend" as MixStyle, mixBars: 8, presets: [] };
  try {
    const p = JSON.parse(localStorage.getItem(MIX_KEY) ?? "null") as { mixStyle?: unknown; mixBars?: unknown; presets?: unknown } | null;
    if (!p) return fallback;
    const presets = Array.isArray(p.presets)
      ? (p.presets as Partial<MixPreset>[]).filter((x) => x && typeof x.name === "string" && goodStyle(x.style) && goodBars(x.bars)).slice(0, MAX_PRESETS).map((x) => ({ name: x.name!.slice(0, 24), style: x.style!, bars: x.bars! }))
      : [];
    return { mixStyle: goodStyle(p.mixStyle) ? p.mixStyle : "blend", mixBars: goodBars(p.mixBars) ? p.mixBars : 8, presets };
  } catch {
    return fallback;
  }
}

function saveMix() {
  const { mixStyle, mixBars, presets } = usePartyUi.getState();
  try {
    localStorage.setItem(MIX_KEY, JSON.stringify({ mixStyle, mixBars, presets }));
  } catch {
    // only a convenience
  }
}

/** Choose the transition the Mix pad starts (remembered on this device). */
export function setMixChoice(choice: Partial<Pick<PartyUi, "mixStyle" | "mixBars">>) {
  usePartyUi.setState(choice);
  saveMix();
}

/** Keep the chosen transition as a preset of your own (up to six; the same one twice is kept once). */
export function savePreset(name: string) {
  const { mixStyle, mixBars, presets } = usePartyUi.getState();
  const preset = { name: name.trim().slice(0, 24) || "My mix", style: mixStyle, bars: mixBars };
  const rest = presets.filter((p) => p.name !== preset.name && !(p.style === preset.style && p.bars === preset.bars));
  usePartyUi.setState({ presets: [...rest, preset].slice(-MAX_PRESETS) });
  saveMix();
}

export function removePreset(index: number) {
  usePartyUi.setState((s) => ({ presets: s.presets.filter((_, i) => i !== index) }));
  saveMix();
}

const SETS_KEY = "cg.party.sets";
export const MAX_SETS = 24;

function loadSets(): SavedSet[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SETS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    const sets: SavedSet[] = [];
    for (const v of raw.slice(0, MAX_SETS)) {
      if (!v || typeof v !== "object") continue;
      const s = v as Partial<SavedSet>;
      const steps = restoredSteps(s.steps);
      if (!steps.length || typeof s.id !== "string") continue;
      sets.push({ id: s.id, name: typeof s.name === "string" && s.name.trim() ? s.name.slice(0, 32) : "My set", steps, savedAt: Number.isFinite(s.savedAt) ? s.savedAt! : 0 });
    }
    return sets;
  } catch {
    return [];
  }
}

function writeSets(sets: SavedSet[]) {
  usePartyUi.setState({ sets });
  try {
    localStorage.setItem(SETS_KEY, JSON.stringify(sets));
  } catch {
    // only a convenience
  }
}

const newSetId = () => `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const cleanName = (name: string, fallback: string) => name.trim().slice(0, 32) || fallback;

/** Keep a set on this device. A set with the same name is replaced (so saving again updates it). Reports its id. */
export function saveSet(set: DeckSet): string {
  const name = cleanName(set.name, "My set");
  const { sets } = usePartyUi.getState();
  const same = sets.find((s) => s.name === name);
  const saved: SavedSet = { id: same?.id ?? newSetId(), name, steps: restoredSteps(set.steps), savedAt: Date.now() };
  writeSets(same ? sets.map((s) => (s.id === same.id ? saved : s)) : [saved, ...sets].slice(0, MAX_SETS));
  return saved.id;
}

export function renameSet(id: string, name: string) {
  const { sets } = usePartyUi.getState();
  writeSets(sets.map((s) => (s.id === id ? { ...s, name: cleanName(name, s.name) } : s)));
}

/** A copy of a set, next to it, called "… copy" (or "… copy 2", and so on). */
export function duplicateSet(id: string) {
  const { sets } = usePartyUi.getState();
  const i = sets.findIndex((s) => s.id === id);
  if (i < 0 || sets.length >= MAX_SETS) return;
  const base = `${sets[i]!.name.slice(0, 24)} copy`;
  let name = base;
  for (let n = 2; sets.some((s) => s.name === name); n++) name = `${base} ${n}`;
  const copy: SavedSet = { ...structuredClone(sets[i]!), id: newSetId(), name, savedAt: Date.now() };
  writeSets([...sets.slice(0, i + 1), copy, ...sets.slice(i + 1)]);
}

export function deleteSet(id: string) {
  writeSets(usePartyUi.getState().sets.filter((s) => s.id !== id));
}

/** (not "cg.music": that one is the game's music switch) */
const KEY = "cg.party.music";

function loadPrefs(): Pick<PartyUi, "volume" | "muted" | "fade"> {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as { volume?: number; muted?: boolean; fade?: boolean } | null;
    if (p) return { volume: Number.isFinite(p.volume) ? Math.min(100, Math.max(0, p.volume!)) : 60, muted: Boolean(p.muted), fade: p.fade !== false };
  } catch {
    // no saved settings, or no storage here
  }
  return { volume: 60, muted: false, fade: true };
}

export const usePartyUi = create<PartyUi>(() => ({ tab: "music", ...loadPrefs(), ...loadMix(), sets: loadSets() }));

/** Each player keeps their own volume and mute, on this device. */
export function setMusicPrefs(prefs: Partial<Pick<PartyUi, "volume" | "muted" | "fade">>) {
  usePartyUi.setState(prefs);
  const { volume, muted, fade } = usePartyUi.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ volume, muted, fade }));
  } catch {
    // only a convenience
  }
}

export const setConsoleTab = (tab: PartyUi["tab"]) => usePartyUi.setState({ tab });

/** Back to the start: leaving a house. */
export function resetPartyUi() {
  usePartyUi.setState({ tab: "music" });
}

// (a handle for poking at it from the browser's console while developing)
if (import.meta.env.DEV) Object.assign(window, { __party: usePartyUi });
