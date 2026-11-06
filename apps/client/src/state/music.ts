import { useSyncExternalStore } from "react";
import { startAmbience, stopAmbience } from "./ambience";

/**
 * Quiet lo-fi music while you're in a house. Browsers only let a page make sound after you've clicked or typed,
 * so it starts on your first one; it fades in and out rather than cutting. The country sounds (ambience) come
 * and go with it. Whether it's on is remembered on this device.
 */

const SRC = "/audio/lofi.m4a";
const VOLUME = 0.32;
const FADE_MS = 1200;
const KEY = "cg.music";

let audio: HTMLAudioElement | null = null;
let wanted = false;
/** Held back while a shared party video is playing on this screen: two tunes at once helps nobody. */
let held = false;
let fade = 0;
const listeners = new Set<() => void>();

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let on = stored();

function fadeTo(target: number, then?: () => void) {
  const a = audio;
  if (!a) return;
  cancelAnimationFrame(fade);
  const from = a.volume;
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / FADE_MS);
    a.volume = from + (target - from) * k;
    if (k < 1) fade = requestAnimationFrame(step);
    else then?.();
  };
  fade = requestAnimationFrame(step);
}

function play() {
  if (!wanted || !on || held) return;
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.volume = 0;
  }
  // refused until the first click or key press; we try again then
  audio
    .play()
    .then(() => {
      fadeTo(VOLUME);
      startAmbience();
    })
    .catch(() => {});
}

function pause() {
  const a = audio;
  if (a && !a.paused) fadeTo(0, () => a.pause());
  stopAmbience();
}

/** The house screen wants music for as long as it's open. */
export function wantMusic() {
  wanted = true;
  const kick = () => {
    if (!audio || audio.paused) play();
  };
  play();
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
  return () => {
    wanted = false;
    window.removeEventListener("pointerdown", kick);
    window.removeEventListener("keydown", kick);
    pause();
  };
}

/** Pause the lo-fi music while party music plays here, and bring it back after. */
export function holdAmbient(hold: boolean) {
  if (hold === held) return;
  held = hold;
  if (hold) pause();
  else play();
}

export function setMusic(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // not remembered, but still switched for now
  }
  if (next) play();
  else pause();
  listeners.forEach((l) => l());
}

export function useMusicOn() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
}
