import { arrivalTime, type Avatar, type LifeAction } from "./state";

/**
 * How each character is doing: hunger, energy, hygiene, bladder, fun and company, each from 0 (desperate) to 100
 * (all good), and a mood made from them. They run down slowly while you're in the house and fill up with what
 * your character does: eating, sleeping, a bath, the toilet, the TV, a hug. Nothing else depends on them.
 *
 * The server only writes down where they stood the last time anything changed (`Needs`), and both screens work out
 * the rest from what the character has been doing since, the same way they work out where someone has walked to.
 */

export const NEEDS = ["hunger", "energy", "hygiene", "bladder", "fun", "social"] as const;
export type Need = (typeof NEEDS)[number];
export type NeedValues = Record<Need, number>;

export interface Needs {
  v: NeedValues;
  /** Server clock milliseconds the values are as of. */
  at: number;
  /** Only someone in the house right now runs down (or fills up); away, everything waits for them. */
  live: boolean;
}

/** Where a new character starts: comfortable, with something to look after before long. */
export const START_NEEDS: NeedValues = { hunger: 80, energy: 85, hygiene: 85, bladder: 75, fun: 70, social: 70 };

/** Points lost a minute, whatever you're doing (roughly: hungry after an hour and a bit). */
export const DECAY: NeedValues = { hunger: 1, energy: 0.6, hygiene: 0.5, bladder: 1.2, fun: 1, social: 0.7 };

type Activity = LifeAction | "walk" | "idle";

/** Points gained (or lost) a minute on top of that, by what you're doing. */
export const GAIN: Partial<Record<Activity, Partial<NeedValues>>> = {
  // a plate takes nine seconds and fills you about halfway
  eat: { hunger: 330, bladder: -6 },
  sleep: { energy: 40, hunger: 0.5, bladder: 0.6 },
  cuddle: { energy: 40, social: 30, hunger: 0.5, bladder: 0.6 },
  lounge: { energy: 8, fun: 4 },
  sit: { energy: 2 },
  bathe: { hygiene: 60, fun: 3 },
  swim: { fun: 20, hygiene: 15, energy: -2 },
  // ten seconds on the toilet empties you; the hand wash after puts the shine back
  toilet: { bladder: 800, hygiene: -15 },
  wash: { hygiene: 150 },
  watch: { fun: 12 },
  play: { fun: 18 },
  pingpong: { fun: 20, social: 6, energy: -2 },
  blackjack: { fun: 15, social: 6 },
  cook: { fun: 4 },
  prep: { fun: 4 },
  hug: { social: 250, fun: 20 },
  kiss: { social: 400, fun: 60 },
  walk: { energy: -0.3 },
};

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Values after `ms` doing `activity`. */
function run(v: NeedValues, activity: Activity, ms: number): NeedValues {
  if (ms <= 0) return v;
  const min = ms / 60000;
  const gain = GAIN[activity] ?? {};
  const out = { ...v };
  for (const n of NEEDS) out[n] = clamp(v[n] + ((gain[n] ?? 0) - DECAY[n]) * min);
  return out;
}

/**
 * A character's needs at time `t`: from the last values written down, through the walk they were on, any wait for
 * their partner, and then whatever they settled into (only until it's due to end: a plate, a hug, the toilet).
 */
export function needsAt(a: Avatar, t: number): NeedValues {
  const n = a.needs;
  if (!n) return { ...START_NEEDS };
  if (!n.live || t <= n.at) return { ...n.v };
  const arrive = arrivalTime(a);
  const starts = Math.max(arrive, a.use?.startsAt ?? arrive);
  const ends = a.use ? Math.max(starts, a.use.until ?? Infinity) : starts;
  // [from, to) spans of time and what was being done
  const spans: [number, number, Activity][] = [
    [-Infinity, arrive, "walk"],
    [arrive, starts, "idle"],
    [starts, ends, a.use?.action ?? "idle"],
    [ends, Infinity, "idle"],
  ];
  let v = { ...n.v };
  for (const [from, to, activity] of spans) v = run(v, activity, Math.min(t, to) - Math.max(n.at, from));
  return v;
}

/** Overall mood from 0 to 100: the average, pulled down hard by whatever's worst. */
export function moodOf(v: NeedValues): number {
  const all = NEEDS.map((n) => v[n]);
  return (all.reduce((s, x) => s + x, 0) / all.length + Math.min(...all)) / 2;
}

/** What a mood reads as. */
export function moodName(mood: number): string {
  return mood >= 75 ? "Very happy" : mood >= 55 ? "Happy" : mood >= 35 ? "Okay" : mood >= 18 ? "Unhappy" : "Miserable";
}

/** Below this a need is pressing: it shows over your head and the bar goes red. */
export const LOW_NEED = 20;

/** The most pressing need, if any is low. */
export function worstNeed(v: NeedValues): Need | null {
  let worst: Need | null = null;
  for (const n of NEEDS) if (v[n] < LOW_NEED && (!worst || v[n] < v[worst])) worst = n;
  return worst;
}
