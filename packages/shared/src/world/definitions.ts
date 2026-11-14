import { z } from "zod";

/**
 * The world's clock and weather: one shared day for the whole house. Everything here is a pure function of the
 * server clock plus a little saved state, so both screens show the same sky without sending a stream of updates,
 * and a refresh or a reconnect picks up exactly where the day is. The server only stores what *changes* it:
 * a shift of the clock (a dev jump to noon) and forced weather.
 */

/** One full day, in real milliseconds: five minutes of daylight (sunrise and sunset included), five of night. */
export const DAY_MS = 10 * 60_000;
/** Daylight takes the first half of the day, from sunrise (phase 0) to sunset (phase 0.5). */
export const SUNSET_PHASE = 0.5;

/** The clock's offset from the real one, so the day can be jumped around in development. */
export interface WorldState {
  /** Milliseconds added to the server clock before it's folded into a day (0 for most houses). */
  dayShift: number;
  /** Weather forced by hand (see weather.ts); missing or "auto" means the natural pattern. */
  weather?: ForcedWeather;
}

export interface ForcedWeather {
  mode: "rain" | "clear";
  /** When it was forced (server ms), so the rain eases in or out from there rather than switching. */
  at: number;
}

export const emptyWorld = (): WorldState => ({ dayShift: 0 });

/** Where in the day it is: 0 at sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight. */
export function dayPhase(now: number, world?: Pick<WorldState, "dayShift"> | null): number {
  const t = now + (world?.dayShift ?? 0);
  return (((t % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
}

/** The day's named moments, as phases. "sunset" is a little before the sun is down, while the sky is golden. */
export const DAY_MOMENTS = { sunrise: 0.03, noon: 0.25, sunset: 0.46, midnight: 0.75 } as const;
export type DayMoment = keyof typeof DAY_MOMENTS;

/** The shift that puts the clock at `phase` at time `now`. */
export function shiftFor(phase: number, now: number): number {
  return (((phase * DAY_MS - now) % DAY_MS) + DAY_MS) % DAY_MS;
}

/** The sun's height: 1 at noon, 0 at sunrise and sunset, -1 at midnight. */
export const sunHeight = (phase: number) => Math.sin(phase * Math.PI * 2);

/** The clock on the wall: sunrise reads 6:00, noon 12:00, sunset 18:00 and midnight 0:00. */
export function clockHour(phase: number): number {
  return (6 + phase * 24) % 24;
}

/** "6:05 AM" for a phase. */
export function clockLabel(phase: number): string {
  const total = Math.floor(clockHour(phase) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** What a member can ask of the world. */
export const WorldCmd = z.discriminatedUnion("cmd", [
  /** Jump the day to a named moment. */
  z.object({ cmd: z.literal("time"), at: z.enum(["sunrise", "noon", "sunset", "midnight"]) }),
  /** Force rain or clear skies, or hand the weather back to the natural pattern. */
  z.object({ cmd: z.literal("weather"), set: z.enum(["rain", "clear", "auto"]) }),
]);
export type WorldCmd = z.infer<typeof WorldCmd>;

/** Plain-language messages for anything the world turns down (nothing does yet, but the table is there for the UI). */
export const WORLD_TEXT = { "bad-world": "The weather can't do that." } as const;
export type WorldReject = keyof typeof WORLD_TEXT;

/** Whatever was saved, made safe: a finite shift within a day, and weather that makes sense. */
export function restoredWorld(saved: unknown): WorldState | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Partial<WorldState>;
  const dayShift = typeof s.dayShift === "number" && Number.isFinite(s.dayShift) ? ((s.dayShift % DAY_MS) + DAY_MS) % DAY_MS : 0;
  const w = s.weather;
  const weather = w && (w.mode === "rain" || w.mode === "clear") && typeof w.at === "number" && Number.isFinite(w.at) ? { mode: w.mode, at: w.at } : undefined;
  if (!dayShift && !weather) return null;
  return { dayShift, ...(weather ? { weather } : {}) };
}

/** Apply a command to the house's world. Returns whether anything changed. */
export function applyWorld(world: WorldState, cmd: WorldCmd, now: number): boolean {
  if (cmd.cmd === "time") {
    const before = dayPhase(now, world);
    world.dayShift = shiftFor(DAY_MOMENTS[cmd.at], now);
    return Math.abs(dayPhase(now, world) - before) > 1e-9;
  }
  if (cmd.set === "auto") {
    const had = Boolean(world.weather);
    delete world.weather;
    return had;
  }
  if (world.weather?.mode === cmd.set) return false;
  world.weather = { mode: cmd.set, at: now };
  return true;
}
