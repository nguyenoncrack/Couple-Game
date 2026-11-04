/**
 * Coming back day after day: each player's visits, their streak, and the coins a visit brings the house. A day is
 * the player's own calendar day where they are ("2026-11-04"), not the server's and not the time of day in the
 * game. A visit counts once a day; the server keeps the list, so refreshing or a second tab never counts twice.
 */

export type Day = string;

/** Coins for each day you come by, and the extra for keeping it up. */
export const DAILY_COINS = 150;
export const MILESTONES: readonly { days: number; coins: number }[] = [
  { days: 3, coins: 300 },
  { days: 7, coins: 750 },
  { days: 14, coins: 1500 },
  { days: 30, coins: 3000 },
];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The days since 1970 of a calendar day, or null if it isn't one. */
export function dayNumber(day: Day): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // no 31st of February
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 86_400_000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day this many days since 1970. */
export function dayFromNumber(n: number): Day {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today where this player is (their device's own date). */
export function localDay(at: Date = new Date()): Day {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Could it be this day somewhere in the world right now? Clocks run from twelve hours behind to fourteen ahead,
 * so a player's date is at most a day either side of the server's.
 */
export function plausibleDay(day: Day, nowMs: number): boolean {
  const n = dayNumber(day);
  if (n === null) return false;
  const utc = Math.floor(nowMs / 86_400_000);
  return n >= utc - 1 && n <= utc + 1;
}

export interface StreakStats {
  /** Days in a row up to today (or yesterday, with today still to come); 0 once a day's been missed. */
  current: number;
  longest: number;
  total: number;
}

/** Runs of consecutive days in a sorted list without repeats, as [first, length]. */
function runs(nums: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n === last[0] + last[1]) last[1]++;
    else out.push([n, 1]);
  }
  return out;
}

const sortedNumbers = (days: Day[]) =>
  [...new Set(days)]
    .map(dayNumber)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

/** Streaks from the days visited, as they stand on `today`. */
export function streakStats(days: Day[], today: Day): StreakStats {
  const nums = sortedNumbers(days);
  const all = runs(nums);
  const t = dayNumber(today);
  const last = all[all.length - 1];
  const end = last ? last[0] + last[1] - 1 : null;
  const current = last && t !== null && end !== null && (end === t || end === t - 1) ? last[1] : 0;
  return { current, longest: Math.max(0, ...all.map((r) => r[1])), total: nums.length };
}

export interface VisitReward {
  /** The streak including this day. */
  streak: number;
  coins: number;
  /** The milestone this day reached, if any. */
  milestone: number | null;
}

/**
 * What visiting on `day` brings, given the days visited before: a day after the last one carries the streak on,
 * anything later starts a new one. Null if it's already been counted, or comes before the last visit.
 */
export function visitReward(before: Day[], day: Day): VisitReward | null {
  const n = dayNumber(day);
  if (n === null) return null;
  const nums = sortedNumbers(before);
  const lastNum = nums[nums.length - 1];
  if (lastNum !== undefined && n <= lastNum) return null;
  const run = runs(nums).at(-1);
  const streak = run && run[0] + run[1] === n ? run[1] + 1 : 1;
  const hit = MILESTONES.find((m) => m.days === streak);
  return { streak, coins: DAILY_COINS + (hit?.coins ?? 0), milestone: hit?.days ?? null };
}

/** The next milestone a streak is heading for, and how many more days it takes. */
export function nextMilestone(current: number): { days: number; coins: number; left: number } | null {
  const m = MILESTONES.find((x) => x.days > current);
  return m ? { ...m, left: m.days - current } : null;
}

/** One visited day, as the server keeps it. */
export interface Visit {
  day: Day;
  /** Coins it brought. */
  coins: number;
  /** The streak that day. */
  streak: number;
}

/** What the server says after a visit is counted: the day, its reward, and the player's visits since. */
export interface VisitResult extends VisitReward {
  day: Day;
}
