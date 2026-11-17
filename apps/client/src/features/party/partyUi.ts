import { create } from "zustand";

/** This player's own party settings and which page of the console is showing. Nothing here is shared. */

interface PartyUi {
  /** The console's page: the decks (or the music player's records), or the lights. */
  tab: "music" | "lights";
  volume: number;
  muted: boolean;
  /** The music gets quieter the further your character is from the speakers (on by default). */
  fade: boolean;
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

export const usePartyUi = create<PartyUi>(() => ({ tab: "music", ...loadPrefs() }));

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
