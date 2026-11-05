import type { Action, Recipe, Station } from "../catalog";
import { STOREY } from "../blueprint";
import type { Rot } from "../grid";
import type { Auto } from "./autonomy";
import type { BlackjackRound } from "./blackjack";
import type { Needs } from "./needs";
import { levelOf, type Point, type Spot } from "./nav";

/**
 * Life in the house: where each character is, what they're doing, the meal on the go and the food waiting on the
 * table. It's separate from the blueprint: nothing here is an edit to the house, so it has no ops and no undo.
 * The server owns it and sends the whole (small) state whenever it changes; times are server clock milliseconds,
 * so both screens can work out the same in-between positions on their own.
 */

/** Walking speed in metres a second. */
export const WALK_SPEED = 2.2;
/** How long eating a plate takes. */
export const EAT_MS = 9000;
/** Each extra pair of hands in the kitchen speeds the meal up by this much. */
export const HELP_BONUS = 0.5;
/** Plates left out at once; older ones are cleared away. */
export const MAX_DISHES = 4;
/** A plate nobody's eaten from for this long goes in the fridge, if the house has one. */
export const LEFTOVER_MS = 30 * 60_000;
/** The fridge holds this many meals; the oldest goes out to make room. */
export const MAX_LEFTOVERS = 12;
/** Things the two of you do face to face, standing up, and how long each lasts. */
export const TOGETHER_MS = {
  hug: 4000,
  kiss: 3000,
  highfive: 2600,
  dance: 9000,
  slowdance: 10_000,
  tickle: 5000,
  joke: 6000,
  talk: 10_000,
  backrub: 8000,
} as const;
export type Together = keyof typeof TOGETHER_MS;
export const isTogether = (action: string | undefined): action is Together => action !== undefined && Object.hasOwn(TOGETHER_MS, action);
export const HUG_MS = TOGETHER_MS.hug;
export const KISS_MS = TOGETHER_MS.kiss;

/** Things the two of you do together: all of those standing up, and cuddling when you're both in the same bed. */
export const SOCIAL = ["hug", "kiss", "highfive", "dance", "slowdance", "tickle", "joke", "talk", "backrub", "cuddle", "uncuddle"] as const;
export type Social = (typeof SOCIAL)[number];

export type LifeAction = Action | "eat" | Together | "cuddle" | "ride";

/** Going up or down in a lift: waiting at its doors, then (once on) riding to floor `to`. */
export interface Ride {
  lift: string;
  to: number;
  /** In the car (rather than waiting for it). */
  on?: boolean;
  /** Where they were going after (the rest of the walk, and what to do there), if anywhere. */
  then?: { goals: Spot[]; use: Use | null };
  /** When they were due at the doors when the ride was planned (to set off what comes after just as late). */
  due?: number;
}

/** What a character is going to do (or is doing) once they get where they're walking. */
export interface Use {
  /** The furniture used, if any (a seat, a bed, a stove). */
  objectId: string | null;
  action: LifeAction;
  slot: number;
  station?: Station;
  /** Where they settle when they arrive: lot metres, height, facing. Null to stay standing where the path ends. */
  pose: { x: number; z: number; y: number; face: Rot } | null;
  /** Eating: the plate, and when the last bite is. A hug, kiss or quick thing (washing your hands): when it's over. */
  dishId?: string;
  until?: number;
  /** Hugging, kissing, cuddling and the rest: who with. */
  with?: string;
  /** The one who started it, when it isn't the same both ways: tickling, telling the joke, giving the back rub. */
  lead?: boolean;
  /** Something together starts once you've both got there; until then you wait, facing each other. */
  startsAt?: number;
  /** Watching or gaming: the TV. When it isn't the object being used, you're on a seat. */
  tv?: string;
  /** Gaming: the console providing a controller; objectId still reserves the seat or TV floor spot. */
  consoleId?: string;
  /** Taking the lift (objectId is the lift). */
  ride?: Ride;
}

export interface Avatar {
  memberId: string;
  /**
   * Points in lot metres (and height, upstairs): the first is where the walk began, the rest are cell centres and
   * the steps of any stairs on the way. Always at least one. The last one's height says which floor they're on.
   */
  path: Point[];
  startedAt: number;
  /** Facing once they've stopped (when not posed by a `use`). */
  face: Rot;
  use: Use | null;
  /** Hunger, energy and the rest as last written down (see needs.ts). Missing on old saves. */
  needs?: Needs;
  /** Set while they're doing something of their own accord (free will), rather than what their player asked. */
  auto?: Auto;
}

export interface Cooking {
  recipeId: string;
  /** The step being worked on, and seconds of it done as of `updatedAt`. */
  step: number;
  done: number;
  /** Seconds of work a second right now: 0 when nobody is at the right station. */
  rate: number;
  updatedAt: number;
  startedBy: string;
}

export interface Dish {
  id: string;
  recipeId: string;
  /** Where the plate sits, in lot metres, and on what. */
  x: number;
  z: number;
  surfaceId: string | null;
  /** The floor it's on (missing: the ground floor). */
  level?: number;
  portions: number;
  /** When it was served, or last eaten from (missing in old saves): left alone too long, it goes in the fridge. */
  servedAt?: number;
}

/** A meal put away in the fridge, to take out again later. */
export interface Leftover {
  id: string;
  recipeId: string;
  portions: number;
  storedAt: number;
}

export interface LifeState {
  avatars: Record<string, Avatar>;
  cooking: Cooking | null;
  dishes: Dish[];
  /** What's in the fridge, oldest first (one for the whole house, whichever fridge you open). Optional for old saves. */
  fridge?: Leftover[];
  /** Optional for old saves. Each card table owns an independent round. */
  blackjack?: Record<string, BlackjackRound>;
  /** Each lift's car, by the lift's id. Optional for old saves (and houses with no lift). */
  lifts?: Record<string, Lift>;
}

/**
 * A lift's car: stopped at `level` (with its doors open until `open`), or on its way between floors (`move`), and the
 * floors it's been called to or asked for, in order.
 */
export interface Lift {
  level: number;
  open?: number;
  move?: { from: number; to: number; departs: number; arrives: number };
  stops: number[];
}

/** How long the car takes per floor, for the doors to close before it sets off, and to stay open at a stop. */
export const LIFT_FLOOR_MS = 1800;
export const LIFT_DOOR_MS = 1200;
export const LIFT_OPEN_MS = 2500;

/** How high the car's floor is at time `t` (metres). */
export function liftHeight(l: Lift, t: number): number {
  const m = l.move;
  if (!m || t >= m.arrives) return (m ? m.to : l.level) * STOREY;
  if (t <= m.departs) return m.from * STOREY;
  const k = (t - m.departs) / (m.arrives - m.departs);
  // eases off and on at each end
  const e = k * k * (3 - 2 * k);
  return (m.from + (m.to - m.from) * e) * STOREY;
}

/** Whether the doors at floor `level` are open at time `t`. */
export const liftOpenAt = (l: Lift, level: number, t: number) => !l.move && l.level === level && l.open !== undefined && t < l.open;

export const emptyLife = (): LifeState => ({ avatars: {}, cooking: null, dishes: [] });

/** How far it is from one point to the next, up or down stairs included. */
const span = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0));

export function pathLength(path: Point[]) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += span(path[i - 1]!, path[i]!);
  return len;
}

/** When a character gets to the end of their path. */
export const arrivalTime = (a: Pick<Avatar, "path" | "startedAt">) => a.startedAt + (pathLength(a.path) / WALK_SPEED) * 1000;

/** The cell a character is standing in, or walking to. */
export function cellOf(a: Avatar): [number, number] {
  const end = a.path[a.path.length - 1]!;
  return [Math.floor(end[0]), Math.floor(end[1])];
}

/** The floor a character is standing on, or walking to. */
export const floorOf = (a: Pick<Avatar, "path">) => levelOf(a.path[a.path.length - 1]!);

/**
 * Where a character is at time `t` along their path (and how high: on stairs, or upstairs), and which way they're
 * heading (radians, as a model's rotation.y; null once they've stopped). `next` is the index of the path point
 * they're walking towards.
 */
export function positionAt(a: Pick<Avatar, "path" | "startedAt">, t: number): { x: number; z: number; y: number; heading: number | null; next: number } {
  let left = (Math.max(0, t - a.startedAt) / 1000) * WALK_SPEED;
  for (let i = 1; i < a.path.length; i++) {
    const p0 = a.path[i - 1]!;
    const p1 = a.path[i]!;
    const seg = span(p0, p1);
    if (seg > 0 && left < seg) {
      const k = left / seg;
      const [x0, z0, y0 = 0] = p0;
      const [x1, z1, y1 = 0] = p1;
      const flat = Math.abs(x1 - x0) + Math.abs(z1 - z0) > 1e-6;
      return { x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, y: y0 + (y1 - y0) * k, heading: flat ? Math.atan2(x1 - x0, z1 - z0) : null, next: i };
    }
    left -= seg;
  }
  const end = a.path[a.path.length - 1]!;
  return { x: end[0], z: end[1], y: end[2] ?? 0, heading: null, next: a.path.length };
}

/** What a character is doing at time `t`: walking, or (once there) their use's action, or standing idle. */
export function activityAt(a: Avatar, t: number): LifeAction | "walk" | "idle" {
  if (t < arrivalTime(a)) return "walk";
  if (a.use?.startsAt !== undefined && t < a.use.startsAt) return "idle";
  return a.use?.action ?? "idle";
}

/** How fast the meal goes, given the stations people are working at right now. */
export function cookingRate(recipe: Recipe, step: number, working: Station[]): number {
  const s = recipe.steps[step];
  if (!s || !working.includes(s.station)) return 0;
  return 1 + HELP_BONUS * (working.length - 1);
}

/** Seconds of the current step done at time `t`. */
export function cookingDone(c: Cooking, recipe: Recipe, t: number): number {
  const total = recipe.steps[c.step]?.seconds ?? 0;
  return Math.min(total, c.done + (c.rate * Math.max(0, t - c.updatedAt)) / 1000);
}
