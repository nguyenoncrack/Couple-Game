import type { Blueprint, Level } from "../blueprint";
import { catalog as defaultCatalog, type Action, type Catalog, type Station } from "../catalog";
import type { Rot } from "../grid";
import { newId } from "../ids";
import { footprintOf } from "../rules";
import { slotsOf, stationSlots, type PlacedSlot } from "./interactions";
import { buildNav, canStep, findPath, nearestWalkable, walkable, type Cell, type Nav } from "./nav";
import {
  activityAt,
  arrivalTime,
  cellOf,
  cookingDone,
  cookingRate,
  EAT_MS,
  MAX_DISHES,
  positionAt,
  type Avatar,
  type Dish,
  type LifeState,
  type Use,
} from "./state";

/**
 * The rules of life in the house. The server keeps one `Life` per house and calls these when a player asks for
 * something (walk here, sit there, cook pancakes), on a timer (`tick`), and whenever the house itself changes
 * (`onBlueprint`). Each call returns a reason if the request can't be done, or null if the state changed.
 */

export type LifeReject = "unreachable" | "taken" | "nothing-to-do" | "already-cooking" | "no-kitchen" | "not-cooking" | "no-dish" | "unknown-recipe";

export const LIFE_TEXT: Record<LifeReject, string> = {
  unreachable: "Can't get there from here.",
  taken: "Someone's already using that.",
  "nothing-to-do": "There's nothing to do with that.",
  "already-cooking": "A meal is already on the go.",
  "no-kitchen": "You'll need a counter and a stove for that.",
  "not-cooking": "Nothing's cooking right now.",
  "no-dish": "That plate's gone.",
  "unknown-recipe": "That recipe isn't in the book.",
};

const center = ([x, z]: Cell): [number, number] => [x + 0.5, z + 0.5];

/** The facing (quarter turns) closest to a direction. */
function rotToward(dx: number, dz: number): Rot {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz >= 0 ? 0 : 2;
}

export class Life {
  /** Members connected right now; only they get any cooking done (so a meal waits for someone who dropped out). */
  online: Set<string> | null = null;

  constructor(
    public state: LifeState,
    private cat: Catalog = defaultCatalog,
    private makeId: () => string = newId,
  ) {}

  private level(bp: Blueprint): Level {
    return bp.levels[0]!;
  }

  /** Make sure a member has a character, starting at the street end of the lot. */
  ensureAvatar(memberId: string, bp: Blueprint, now: number): boolean {
    if (this.state.avatars[memberId]) return false;
    const nav = buildNav(bp, 0, this.cat);
    const others = new Set(Object.values(this.state.avatars).map((a) => cellOf(a).join(":")));
    let spot = nearestWalkable(nav, [Math.floor(bp.lot.w / 2), bp.lot.d - 1]) ?? [0, 0];
    if (others.has(spot.join(":"))) spot = nearestWalkable({ ...nav, blocked: Uint8Array.from(nav.blocked, (b, i) => (i === spot[1] * nav.w + spot[0] ? 1 : b)) }, spot) ?? spot;
    this.state.avatars[memberId] = { memberId, path: [center(spot)], startedAt: now, face: 2, use: null };
    return true;
  }

  /** Where a character can start a new walk from without jumping: the cell they're stepping into. */
  private origin(a: Avatar, now: number) {
    const p = positionAt(a, now);
    const target = p.next < a.path.length ? a.path[p.next]! : a.path[a.path.length - 1]!;
    return { at: [p.x, p.z] as [number, number], cell: [Math.floor(target[0]), Math.floor(target[1])] as Cell };
  }

  /** Walk a character to the nearest of `goals`, to do `use` when they get there. */
  private walkTo(a: Avatar, nav: Nav, goals: Cell[], use: Use | null, now: number): LifeReject | null {
    const o = this.origin(a, now);
    const cells = findPath(nav, o.cell, goals);
    if (!cells) return "unreachable";
    const points = cells.map(center);
    const first = points[0]!;
    if (Math.hypot(first[0] - o.at[0], first[1] - o.at[1]) > 1e-3) points.unshift(o.at);
    a.path = points;
    a.startedAt = now;
    if (points.length > 1) {
      const [x0, z0] = points[points.length - 2]!;
      const [x1, z1] = points[points.length - 1]!;
      a.face = rotToward(x1 - x0, z1 - z0);
    }
    a.use = use;
    return null;
  }

  /** Is this slot used (or about to be) by someone else? */
  private taken(s: Pick<PlacedSlot, "objectId" | "slot">, memberId: string) {
    return Object.values(this.state.avatars).some((o) => o.memberId !== memberId && o.use?.objectId === s.objectId && o.use.slot === s.slot);
  }

  /** Send a character to the free slot (of several) that's quickest to reach. */
  private goUse(a: Avatar, nav: Nav, slots: PlacedSlot[], now: number, extra: Partial<Use> = {}): LifeReject | null {
    const free = slots.filter((s) => !this.taken(s, a.memberId));
    if (!slots.length) return "nothing-to-do";
    if (!free.length) return "taken";
    const from = this.origin(a, now).cell;
    let best: { s: PlacedSlot; cells: Cell[] } | null = null;
    for (const s of free) {
      const cells = findPath(nav, from, s.stand) ?? findPath(nav, from, s.around);
      if (cells && (!best || cells.length < best.cells.length)) best = { s, cells };
    }
    if (!best) return "unreachable";
    const { s } = best;
    return this.walkTo(a, nav, [best.cells[best.cells.length - 1]!], { objectId: s.objectId, action: s.action, slot: s.slot, station: s.station, pose: s.pose, ...extra }, now);
  }

  walk(memberId: string, bp: Blueprint, cell: Cell, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    if (!a) return "unreachable";
    const nav = buildNav(bp, 0, this.cat);
    const goal = walkable(nav, cell[0], cell[1]) ? cell : nearestWalkable(nav, cell);
    if (!goal) return "unreachable";
    return this.walkTo(a, nav, [goal], null, now);
  }

  use(memberId: string, bp: Blueprint, objectId: string, action: Action, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const o = this.level(bp).objects[objectId];
    if (!a || !o) return "nothing-to-do";
    return this.goUse(a, buildNav(bp, 0, this.cat), slotsOf(o, action, this.cat), now);
  }

  /** Stand still (getting up if sitting), stopping at the next cell if walking. */
  stop(memberId: string, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    if (!a) return "nothing-to-do";
    const p = positionAt(a, now);
    if (p.next < a.path.length) {
      a.path = [[p.x, p.z], a.path[p.next]!];
      a.startedAt = now;
    }
    if (a.use?.pose) a.face = a.use.pose.face;
    a.use = null;
    return null;
  }

  // --- cooking ---

  private sendToStation(a: Avatar, bp: Blueprint, station: Station, now: number, objectId: string | null = null) {
    const level = this.level(bp);
    const nav = buildNav(bp, 0, this.cat);
    const own = objectId && level.objects[objectId] ? slotsOf(level.objects[objectId], undefined, this.cat).filter((s) => s.station === station) : [];
    if (own.length && this.goUse(a, nav, own, now) === null) return null;
    return this.goUse(a, nav, stationSlots(level, station, this.cat), now);
  }

  cook(memberId: string, bp: Blueprint, recipeId: string, objectId: string | null, now: number): LifeReject | null {
    const recipe = this.cat.recipes.get(recipeId);
    const a = this.state.avatars[memberId];
    if (!recipe || !a) return "unknown-recipe";
    if (this.state.cooking) return "already-cooking";
    const level = this.level(bp);
    if (recipe.steps.some((s) => stationSlots(level, s.station, this.cat).length === 0)) return "no-kitchen";
    const r = this.sendToStation(a, bp, recipe.steps[0]!.station, now, objectId);
    if (r) return r;
    this.state.cooking = { recipeId, step: 0, done: 0, rate: 0, updatedAt: now, startedBy: memberId };
    return null;
  }

  /** Lend a hand: go where the meal needs someone (the current step's station if it's free, else the other one). */
  help(memberId: string, bp: Blueprint, now: number): LifeReject | null {
    const c = this.state.cooking;
    const a = this.state.avatars[memberId];
    if (!c || !a) return "not-cooking";
    const recipe = this.cat.recipes.get(c.recipeId)!;
    const current = recipe.steps[c.step]!.station;
    const covered = Object.values(this.state.avatars).some((o) => o.memberId !== memberId && o.use?.station === current);
    const other = recipe.steps.map((s) => s.station).find((s) => s !== current);
    const order: Station[] = covered && other ? [other, current] : [current, ...(other ? [other] : [])];
    let last: LifeReject | null = "taken";
    for (const station of order) {
      last = this.sendToStation(a, bp, station, now);
      if (!last) return null;
    }
    return last;
  }

  cancelCooking(): LifeReject | null {
    if (!this.state.cooking) return "not-cooking";
    this.state.cooking = null;
    return null;
  }

  /** Who's at a station and working right now (arrived, not still walking over). */
  private workers(now: number) {
    return Object.values(this.state.avatars).filter((a) => a.use?.station && now >= arrivalTime(a) && (!this.online || this.online.has(a.memberId)));
  }

  // --- eating ---

  eat(memberId: string, bp: Blueprint, dishId: string, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const dish = this.state.dishes.find((d) => d.id === dishId);
    if (!a || !dish) return "no-dish";
    const eating = Object.values(this.state.avatars).filter((o) => o.memberId !== memberId && o.use?.dishId === dishId).length;
    if (eating >= dish.portions) return "taken";
    const level = this.level(bp);
    const nav = buildNav(bp, 0, this.cat);
    // a seat at the plate's table if there is one, otherwise stand by the plate
    const table = dish.surfaceId ? level.objects[dish.surfaceId] : undefined;
    const item = table && this.cat.furniture.get(table.catalogId);
    const f = table && item ? footprintOf(item, table) : { x: dish.x, z: dish.z, w: 0, d: 0 };
    const gap = (x: number, z: number) => Math.hypot(Math.max(f.x - x, 0, x - f.x - f.w), Math.max(f.z - z, 0, z - f.z - f.d));
    const seats: PlacedSlot[] = [];
    for (const o of Object.values(level.objects)) for (const s of slotsOf(o, "sit", this.cat)) if (gap(s.pose.x, s.pose.z) < 0.9) seats.push(s);
    if (seats.length && this.goUse(a, nav, seats, now, { action: "eat", dishId }) === null) {
      a.use!.until = arrivalTime(a) + EAT_MS;
      return null;
    }
    const dc: Cell = [Math.floor(dish.x), Math.floor(dish.z)];
    const around: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) around.push([dc[0] + dx, dc[1] + dz]);
    const r = this.walkTo(a, nav, around, { objectId: null, action: "eat", slot: 0, pose: null, dishId }, now);
    if (r) return r;
    const end = a.path[a.path.length - 1]!;
    a.face = rotToward(dish.x - end[0], dish.z - end[1]);
    a.use!.until = arrivalTime(a) + EAT_MS;
    return null;
  }

  private serve(bp: Blueprint, recipeId: string, near: { x: number; z: number }) {
    const level = this.level(bp);
    let best: { id: string | null; x: number; z: number; dist: number } | null = null;
    for (const o of Object.values(level.objects)) {
      const item = this.cat.furniture.get(o.catalogId);
      if (!item?.surface) continue;
      const f = footprintOf(item, o);
      const x = f.x + f.w / 2;
      const z = f.z + f.d / 2;
      const dist = Math.hypot(x - near.x, z - near.z);
      if (!best || dist < best.dist) best = { id: o.id, x, z, dist };
    }
    const spot = best ?? { id: null, x: near.x, z: near.z };
    // plates already on that table shuffle along
    const already = this.state.dishes.filter((d) => d.surfaceId === spot.id && spot.id !== null).length;
    const dish: Dish = { id: this.makeId(), recipeId, x: spot.x + (already % 2 ? 0.45 : -0.45) * Math.ceil(already / 2), z: spot.z, surfaceId: spot.id, portions: this.cat.recipes.get(recipeId)?.serves ?? 1 };
    this.state.dishes.push(dish);
    while (this.state.dishes.length > MAX_DISHES) {
      const i = this.state.dishes.findIndex((d) => !Object.values(this.state.avatars).some((a) => a.use?.dishId === d.id));
      this.state.dishes.splice(i < 0 ? 0 : i, 1);
    }
  }

  // --- time passing ---

  /** Move time forward: finish meals and plates, and keep the cooking speed right. True if anything changed. */
  tick(bp: Blueprint, now: number): boolean {
    let changed = false;
    for (const a of Object.values(this.state.avatars)) {
      const u = a.use;
      if (u?.action !== "eat" || u.until === undefined || now < u.until) continue;
      const dish = this.state.dishes.find((d) => d.id === u.dishId);
      if (dish) {
        dish.portions -= 1;
        if (dish.portions <= 0) this.state.dishes = this.state.dishes.filter((d) => d !== dish);
      }
      // stay seated after eating; standing eaters just stand
      a.use = u.objectId ? { ...u, action: "sit", dishId: undefined, until: undefined } : null;
      changed = true;
    }

    const c = this.state.cooking;
    if (!c) return changed;
    const recipe = this.cat.recipes.get(c.recipeId);
    if (!recipe) {
      this.state.cooking = null;
      return true;
    }
    const step = recipe.steps[c.step]!;
    const done = cookingDone(c, recipe, now);
    if (done >= step.seconds) {
      const finishers = this.workers(now).filter((a) => a.use?.station === step.station);
      c.step += 1;
      c.done = 0;
      c.updatedAt = now;
      c.rate = 0;
      if (c.step >= recipe.steps.length) {
        const last = finishers[0];
        const near = last?.use?.pose ?? (last ? { x: last.path[0]![0], z: last.path[0]![1] } : { x: bp.lot.w / 2, z: bp.lot.d / 2 });
        this.serve(bp, recipe.id, near);
        for (const a of this.workers(now)) this.stop(a.memberId, now);
        this.state.cooking = null;
        return true;
      }
      // if nobody is at the next step's station yet, whoever just finished heads over
      const next = recipe.steps[c.step]!.station;
      const ready = Object.values(this.state.avatars).some((a) => a.use?.station === next);
      if (!ready && finishers[0]) this.sendToStation(finishers[0], bp, next, now);
      changed = true;
    }
    const rate = cookingRate(recipe, c.step, this.workers(now).map((a) => a.use!.station!));
    if (rate !== c.rate) {
      c.done = cookingDone(c, recipe, now);
      c.updatedAt = now;
      c.rate = rate;
      changed = true;
    }
    return changed;
  }

  /**
   * The house changed under everyone's feet: anyone using furniture that moved or went stops, walks that are
   * now blocked find another way (or stop), anyone furniture landed on steps aside, and plates on a table that
   * went are cleared. True if anything changed.
   */
  onBlueprint(bp: Blueprint, now: number): boolean {
    const level = this.level(bp);
    const nav = buildNav(bp, 0, this.cat);
    let changed = false;
    for (const a of Object.values(this.state.avatars)) {
      const u = a.use;
      if (u?.objectId) {
        const o = level.objects[u.objectId];
        const s = o ? slotsOf(o, u.action === "eat" ? "sit" : (u.action as Action), this.cat)[u.slot] : undefined;
        if (!s || !u.pose || s.pose.x !== u.pose.x || s.pose.z !== u.pose.z || s.pose.face !== u.pose.face) {
          if (u.pose) a.face = u.pose.face;
          a.use = null;
          changed = true;
        }
      }
      const p = positionAt(a, now);
      if (p.next < a.path.length) {
        // still walking: is the rest of the way still open?
        let open = true;
        for (let i = Math.max(p.next, 1); i < a.path.length && open; i++) {
          const [x0, z0] = a.path[i - 1]!.map(Math.floor) as Cell;
          const [x1, z1] = a.path[i]!.map(Math.floor) as Cell;
          if ((x0 !== x1 || z0 !== z1) && !canStep(nav, x0, z0, x1, z1)) open = false;
        }
        if (!open) {
          const goal = cellOf(a);
          if (this.walkTo(a, nav, [goal], a.use, now)) this.stop(a.memberId, now);
          changed = true;
        }
      } else {
        const here = cellOf(a);
        if (!walkable(nav, here[0], here[1])) {
          const to = nearestWalkable(nav, here);
          if (to) {
            a.path = [[p.x, p.z], center(to)];
            a.startedAt = now;
            a.use = null;
            changed = true;
          }
        }
      }
    }
    const kept: Dish[] = [];
    for (const d of this.state.dishes) {
      if (d.surfaceId && !level.objects[d.surfaceId]) {
        changed = true;
        for (const a of Object.values(this.state.avatars)) if (a.use?.dishId === d.id) a.use = a.use.objectId ? { ...a.use, action: "sit", dishId: undefined, until: undefined } : null;
      } else kept.push(d);
    }
    this.state.dishes = kept;
    return changed;
  }

  /** Pick up from a saved state on a new clock: everyone where they were, meals paused, eating finished. */
  static restore(saved: LifeState, now: number, cat: Catalog = defaultCatalog): Life {
    const state: LifeState = { avatars: {}, cooking: null, dishes: saved.dishes ?? [] };
    for (const a of Object.values(saved.avatars ?? {})) {
      const end = a.path[a.path.length - 1]!;
      const use = a.use?.action === "eat" ? (a.use.objectId ? { ...a.use, action: "sit" as const, dishId: undefined, until: undefined } : null) : a.use;
      state.avatars[a.memberId] = { ...a, path: [end], startedAt: now, use };
    }
    if (saved.cooking) state.cooking = { ...saved.cooking, rate: 0, updatedAt: now };
    return new Life(state, cat);
  }

  /** What to save: everyone where they'll end up, standing or settled, with no walk in progress. */
  saved(now: number): LifeState {
    const avatars: LifeState["avatars"] = {};
    for (const a of Object.values(this.state.avatars)) {
      const end = a.path[a.path.length - 1]!;
      const settled = activityAt(a, now) !== "walk";
      avatars[a.memberId] = { ...a, path: [end], startedAt: 0, use: settled || a.use?.action !== "eat" ? a.use : null };
    }
    const c = this.state.cooking;
    const recipe = c && this.cat.recipes.get(c.recipeId);
    return {
      avatars,
      cooking: c && recipe ? { ...c, done: cookingDone(c, recipe, now), rate: 0, updatedAt: 0 } : null,
      dishes: this.state.dishes.map((d) => ({ ...d })),
    };
  }
}
