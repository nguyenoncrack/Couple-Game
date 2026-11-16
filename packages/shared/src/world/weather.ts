import { DAY_MS, type WorldState } from "./definitions";

/**
 * The weather, from the same shared clock as the day. Rain comes and goes on its own pattern (some stretch of most
 * four-minute spells of weather, at any hour of the day or night), and the day's clock is never touched by it: the
 * two are independent, so rain can start in the middle of the night or stop at noon. Both screens, a refresh and a
 * reconnect all work out the same rain from the server time alone. Someone can also force rain or clear skies (see
 * `ForcedWeather`), which eases in over a few seconds from whatever the weather was doing.
 */

/** The weather's own spells, in real milliseconds. */
export const SPELL_MS = 4 * 60_000;
/** How long rain takes to build up and die away. */
export const RAMP_MS = 12_000;
/** And when it's forced on or off by hand. */
export const FORCE_RAMP_MS = 6_000;
/** Chance a spell has rain in it. */
const RAIN_CHANCE = 0.5;

/** A small, fixed hash of a whole number to [0, 1): the same on every screen. */
function hash01(n: number, salt: number): number {
  let h = (n * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** The spell number a moment falls in, and the rain's shape within it (if it rains in that spell at all). */
export function spellRain(spell: number): { start: number; end: number; peak: number } | null {
  if (hash01(spell, 1) >= RAIN_CHANCE) return null;
  const length = 70_000 + hash01(spell, 2) * 120_000;
  // the rain sits inside the spell with room for its ramps either side, so neighbouring spells never overlap
  const room = SPELL_MS - length - 2 * RAMP_MS;
  const start = RAMP_MS + hash01(spell, 3) * room;
  return { start, end: start + length, peak: 0.55 + hash01(spell, 4) * 0.45 };
}

/** The rain the weather's own pattern gives at server time `now`, 0 (dry) to 1 (pouring). */
export function naturalRain(now: number): number {
  const spell = Math.floor(now / SPELL_MS);
  const r = spellRain(spell);
  if (!r) return 0;
  const t = now - spell * SPELL_MS;
  const up = smooth((t - (r.start - RAMP_MS)) / RAMP_MS);
  const down = 1 - smooth((t - r.end) / RAMP_MS);
  return r.peak * up * down;
}

/** The rain at server time `now`: natural, or eased towards whatever was forced. 0 to 1. */
export function rainAt(now: number, world?: Pick<WorldState, "weather"> | null): number {
  const f = world?.weather;
  if (!f) return naturalRain(now);
  const k = smooth((now - f.at) / FORCE_RAMP_MS);
  const from = f.from ?? naturalRain(f.at);
  const target = f.mode === "rain" ? 1 : f.mode === "clear" ? 0 : naturalRain(now);
  return from + (target - from) * k;
}

/** Whether it's properly raining (enough to hear and see). */
export const isRaining = (now: number, world?: Pick<WorldState, "weather"> | null) => rainAt(now, world) > 0.15;

/**
 * How wet the ground is: the heaviest rain of the last minute and a half, fading as it dries out, so puddles are
 * there after the rain stops, then shrink away. Worked out from the clock like the rain itself, so it's the same on
 * every screen and survives a refresh.
 */
export const DRY_MS = 90_000;
export function wetAt(now: number, world?: Pick<WorldState, "weather"> | null): number {
  const f = world?.weather;
  let wet = 0;
  for (let back = 0; back <= DRY_MS; back += 6000) {
    const t = now - back;
    // (a forced setting only speaks for the time since it was set; before that, its `wet` carries what had been)
    if (f && t < f.at) continue;
    wet = Math.max(wet, rainAt(t, world) * (1 - back / DRY_MS));
  }
  wet = Math.min(1, wet * 1.6);
  if (f?.wet) wet = Math.max(wet, f.wet * Math.max(0, 1 - (now - f.at) / DRY_MS));
  return wet;
}

/** The next time the natural weather changes between wet and dry after `now` (for tests and the like). */
export function nextNaturalChange(now: number, step = 1000): number {
  const dry = naturalRain(now) < 0.01;
  for (let t = now + step; t < now + DAY_MS * 3; t += step) if ((naturalRain(t) < 0.01) !== dry) return t;
  return Infinity;
}
