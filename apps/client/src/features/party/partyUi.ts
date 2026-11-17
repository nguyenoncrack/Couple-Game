import { MIX_BARS, MIX_STYLE_IDS, type MixStyle } from "@cg/shared";
import { create } from "zustand";

/** This player's own party settings and which page of the console is showing. Nothing here is shared. */

interface PartyUi {
  tab: "music" | "lights" | "guide";
  volume: number;
  muted: boolean;
  /** The music gets quieter the further your character is from the speakers (on by default). */
  fade: boolean;
  /** The transition the Mix pad starts, and this player's own saved transitions. */
  mixStyle: MixStyle;
  mixBars: number;
  presets: MixPreset[];
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

export const usePartyUi = create<PartyUi>(() => ({ tab: "music", ...loadPrefs(), ...loadMix() }));

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
