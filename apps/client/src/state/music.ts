import { useSyncExternalStore } from "react";
import { setAmbienceRain, startAmbience, stopAmbience } from "./ambience";

/**
 * The game's own sound while you're in a house, with three switches remembered on this device:
 * - **Sound**: everything (the music, the country sounds, the rain and the party's music).
 * - **Music**: the quiet lo-fi background music.
 * - **Rain**: the sound of rain, and the rain falling on your screen (the weather itself is shared and carries on).
 *
 * Browsers only let a page make sound after you've clicked or typed, so it starts on your first one; it fades in and
 * out rather than cutting.
 */

const SRC = "/audio/lofi.m4a";
const VOLUME = 0.32;
const FADE_MS = 1200;
const KEYS = { sound: "cg.music", music: "cg.bgmusic", rain: "cg.rain" } as const;
export type SoundSetting = keyof typeof KEYS;

let audio: HTMLAudioElement | null = null;
let wanted = false;
/** Held back while the party's music is playing on this screen: two tunes at once helps nobody. */
let held = false;
let fade = 0;
const listeners = new Set<() => void>();

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}

let settings: Record<SoundSetting, boolean> = { sound: stored(KEYS.sound), music: stored(KEYS.music), rain: stored(KEYS.rain) };

function fadeTo(target: number, then?: () => void) {
  const a = audio;
  if (!a) return;
  cancelAnimationFrame(fade);
  const from = a.volume;
  const start = performance.now();
  const step = (now: number) => {
    // (a frame can be stamped a touch before the fade began)
    const k = Math.min(1, Math.max(0, (now - start) / FADE_MS));
    a.volume = from + (target - from) * k;
    if (k < 1) fade = requestAnimationFrame(step);
    else then?.();
  };
  fade = requestAnimationFrame(step);
}

/** Bring everything in line with the switches: the lo-fi music, the country sounds and the rain. */
function sync() {
  const sound = wanted && settings.sound && !held;
  setAmbienceRain(settings.rain);
  if (sound) startAmbience();
  else stopAmbience();
  if (sound && settings.music) {
    if (!audio) {
      audio = new Audio(SRC);
      audio.loop = true;
      audio.volume = 0;
    }
    const a = audio;
    // already playing (or fading out after a quick off and on): back up to full
    if (!a.paused) {
      if (a.volume < VOLUME) fadeTo(VOLUME);
      return;
    }
    // refused until the first click or key press; we try again then
    a.play()
      .then(() => fadeTo(VOLUME))
      .catch(() => {});
  } else {
    const a = audio;
    if (a && !a.paused) fadeTo(0, () => a.pause());
  }
}

/** The house screen wants music for as long as it's open. */
export function wantMusic() {
  wanted = true;
  const kick = () => sync();
  sync();
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
  return () => {
    wanted = false;
    window.removeEventListener("pointerdown", kick);
    window.removeEventListener("keydown", kick);
    sync();
  };
}

/** Pause the lo-fi music while party music plays here, and bring it back after. */
export function holdAmbient(hold: boolean) {
  if (hold === held) return;
  held = hold;
  sync();
}

/** Turn one of the sound switches on or off (remembered on this device). */
export function setSound(which: SoundSetting, next: boolean) {
  settings = { ...settings, [which]: next };
  try {
    localStorage.setItem(KEYS[which], next ? "on" : "off");
  } catch {
    // not remembered, but still switched for now
  }
  sync();
  listeners.forEach((l) => l());
}

/** The sound switches. */
export function useSoundSettings(): Record<SoundSetting, boolean> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

/** Whether the game's sound is on at all (the party's music follows it too). */
export const useMusicOn = () => useSoundSettings().sound;
/** Whether rain shows and sounds on this screen. */
export const useRainOn = () => useSoundSettings().rain;

// (a look at the music from the browser's console while developing)
if (import.meta.env.DEV) Object.assign(window, { __music: () => ({ settings, wanted, held, playing: Boolean(audio && !audio.paused), volume: audio?.volume ?? 0 }) });
