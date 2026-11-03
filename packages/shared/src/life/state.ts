import type { Action, Recipe, Station } from "../catalog";
import type { Rot } from "../grid";

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
/** How long a hug and a kiss last. */
export const HUG_MS = 4000;
export const KISS_MS = 3000;

/** Things the two of you do together: hug and kiss standing up, cuddle when you're both in the same bed. */
export const SOCIAL = ["hug", "kiss", "cuddle", "uncuddle"] as const;
export type Social = (typeof SOCIAL)[number];

export type LifeAction = Action | "eat" | "hug" | "kiss" | "cuddle";

/** What a character is going to do (or is doing) once they get where they're walking. */
export interface Use {
  /** The furniture used, if any (a seat, a bed, a stove). */
  objectId: string | null;
  action: LifeAction;
  slot: number;
  station?: Station;
  /** Where they settle when they arrive: lot metres, height, facing. Null to stay standing where the path ends. */
  pose: { x: number; z: number; y: number; face: Rot } | null;
  /** Eating: the plate, and when the last bite is. A hug or kiss: when it's over. */
  dishId?: string;
  until?: number;
  /** Hugging, kissing or cuddling: who with. */
  with?: string;
  /** A hug or kiss starts once you've both got there; until then you wait, facing each other. */
  startsAt?: number;
}

export interface Avatar {
  memberId: string;
  /** Points in lot metres: the first is where the walk began, the rest are cell centres. Always at least one. */
  path: [number, number][];
  startedAt: number;
  /** Facing once they've stopped (when not posed by a `use`). */
  face: Rot;
  use: Use | null;
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
  portions: number;
}

export interface LifeState {
  avatars: Record<string, Avatar>;
  cooking: Cooking | null;
  dishes: Dish[];
}

export const emptyLife = (): LifeState => ({ avatars: {}, cooking: null, dishes: [] });

export function pathLength(path: [number, number][]) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  return len;
}

/** When a character gets to the end of their path. */
export const arrivalTime = (a: Pick<Avatar, "path" | "startedAt">) => a.startedAt + (pathLength(a.path) / WALK_SPEED) * 1000;

/** The cell a character is standing in, or walking to. */
export function cellOf(a: Avatar): [number, number] {
  const end = a.path[a.path.length - 1]!;
  return [Math.floor(end[0]), Math.floor(end[1])];
}

/**
 * Where a character is at time `t` along their path, and which way they're heading (radians, as a model's
 * rotation.y; null once they've stopped). `next` is the index of the path point they're walking towards.
 */
export function positionAt(a: Pick<Avatar, "path" | "startedAt">, t: number): { x: number; z: number; heading: number | null; next: number } {
  let left = (Math.max(0, t - a.startedAt) / 1000) * WALK_SPEED;
  for (let i = 1; i < a.path.length; i++) {
    const [x0, z0] = a.path[i - 1]!;
    const [x1, z1] = a.path[i]!;
    const seg = Math.hypot(x1 - x0, z1 - z0);
    if (seg > 0 && left < seg) {
      const k = left / seg;
      return { x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, heading: Math.atan2(x1 - x0, z1 - z0), next: i };
    }
    left -= seg;
  }
  const end = a.path[a.path.length - 1]!;
  return { x: end[0], z: end[1], heading: null, next: a.path.length };
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
