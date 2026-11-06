import { create } from "zustand";

/** What this screen is doing with the party: panel, and how its own player is going. Nothing here is shared. */

export type MusicStatus = "off" | "loading" | "ready" | "buffering" | "playing" | "paused" | "blocked" | "error";

interface PartyUi {
  open: boolean;
  tab: "lights" | "dance" | "music";
  /** This screen has joined the music: its player is up (and must stay visible while it plays). */
  listening: boolean;
  status: MusicStatus;
  /** Why the player can't play something, in words. */
  message: string | null;
  volume: number;
  muted: boolean;
  /** The music gets quieter the further your character is from the speakers (on by default). */
  fade: boolean;
}

/** (not "cg.music": that one is the lo-fi background music switch) */
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

export const usePartyUi = create<PartyUi>(() => ({ open: false, tab: "lights", listening: false, status: "off", message: null, ...loadPrefs() }));

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

export const openParty = (tab?: PartyUi["tab"]) => usePartyUi.setState({ open: true, ...(tab ? { tab } : {}) });
export const closeParty = () => usePartyUi.setState({ open: false });

/** Back to nothing: leaving a house. */
export function resetPartyUi() {
  usePartyUi.setState({ open: false, listening: false, status: "off", message: null });
}

// (a handle for poking at it from the browser's console while developing)
if (import.meta.env.DEV) Object.assign(window, { __party: usePartyUi });
