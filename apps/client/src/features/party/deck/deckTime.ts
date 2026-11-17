import { DEFAULT_BPM } from "@cg/shared";

/** Places in a record are counted in track beats at the default tempo; these turn them into times you can read and type. */

export const beatsToSeconds = (beats: number) => (beats * 60) / DEFAULT_BPM;
export const secondsToBeats = (seconds: number) => (seconds * DEFAULT_BPM) / 60;

/**
 * A typed time, in seconds: "1:24.5", "84.5", "1:02:03" or "1:02:03.25" (or null if it isn't one). Commas work as
 * decimal points, and spaces around it are ignored.
 */
export function parseClock(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(":");
  const last = Number(parts.pop());
  if (parts.length && last >= 60) return null;
  const whole = parts.map(Number);
  if (whole.length === 2 && whole[1]! >= 60) return null;
  const seconds = whole.reduce((sum, n) => sum * 60 + n, 0) * 60 + last;
  return Number.isFinite(seconds) ? seconds : null;
}

/** A place in a record as m:ss, with tenths when it isn't on a whole second ("1:24.5"), or h:mm:ss for long ones. */
export function preciseClock(beats: number): string {
  const tenths = Math.round(Math.max(0, beatsToSeconds(beats)) * 10);
  const total = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  const base = h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  return frac ? `${base}.${frac}` : base;
}
