import { STOREY, type Blueprint, type Level, type PlacedObject } from "../blueprint";
import { liftsIn, type Shaft } from "../lifts";
import { catalog as defaultCatalog, type Action, type Catalog, type Station } from "../catalog";
import type { Rot } from "../grid";
import { newId } from "../ids";
import { footprintOf } from "../rules";
import { canSee, screenOf, seatsFacing, slotsFor, slotsOf, stationSlots, tvFacing, type PlacedSlot } from "./interactions";
import { gamingSpots } from "./gaming";
import { dealBlackjack, finishBlackjack, playBlackjack, type BlackjackCommand } from "./blackjack";
import { FreeWill } from "./autonomy";
import { applyParty, isDance, partyGear, restoredParty, savedParty, type PartyCmd } from "../party";
import { needsAt, START_NEEDS } from "./needs";
import { buildNav, canStep, findRoute, levelOf, liftStops, linkBetween, linksOf, nearestWalkable, roomAt, slide, walkable, type Cell, type Point, type Spot } from "./nav";
import {
  activityAt,
  arrivalTime,
  cellOf,
  floorOf,
  cookingDone,
  cookingRate,
  EAT_MS,
  isTogether,
  LEFTOVER_MS,
  LIFT_DOOR_MS,
  LIFT_FLOOR_MS,
  LIFT_OPEN_MS,
  liftHeight,
  MAX_DISHES,
  MAX_LEFTOVERS,
  positionAt,
  type Avatar,
  type Dish,
  type Leftover,
  type Lift,
  type LifeState,
  type Ride,
  type Social,
  TOGETHER_MS,
  type Use,
} from "./state";

/**
 * The rules of life in the house. The server keeps one `Life` per house and calls these when a player asks for
 * something (walk here, sit there, cook pancakes), on a timer (`tick`), and whenever the house itself changes
 * (`onBlueprint`). Each call returns a reason if the request can't be done, or null if the state changed.
 */

export type LifeReject =
  | "unreachable"
  | "taken"
  | "nothing-to-do"
  | "already-cooking"
  | "no-kitchen"
  | "not-cooking"
  | "no-dish"
  | "unknown-recipe"
  | "partner-away"
  | "partner-busy"
  | "not-in-bed"
  | "no-tv"
  | "no-fridge"
  | "in-lift"
  | "not-at-table"
  | "round-changed"
  | "round-active"
  | "round-over";

export const LIFE_TEXT: Record<LifeReject, string> = {
  unreachable: "Can't get there from here.",
  taken: "Someone's already using that.",
  "nothing-to-do": "There's nothing to do with that.",
  "already-cooking": "A meal is already on the go.",
  "no-kitchen": "You'll need a counter and a stove for that.",
  "not-cooking": "Nothing's cooking right now.",
  "no-dish": "That plate's gone.",
  "unknown-recipe": "That recipe isn't in the book.",
  "partner-away": "Your partner isn't here right now.",
  "partner-busy": "Your partner's busy. Try again in a moment.",
  "not-in-bed": "Get into the same bed first.",
  "no-tv": "There's no TV in view from here.",
  "no-fridge": "There's no fridge to keep it in.",
  "in-lift": "Hang on, you're in the lift.",
  "not-at-table": "Join the card table and finish walking there first.",
  "round-changed": "The round changed. Choose again from the current hand.",
  "round-active": "Finish this round before dealing another.",
  "round-over": "Your hand is finished. Wait for the next deal.",
};

/** The furniture action a use is based on (eating or watching TV from a seat is sitting, cuddling is sleeping). */
const slotAction = (u: Use): Action =>
  u.action === "play" ? (u.tv === u.objectId ? "watch" : "sit") :
  u.action === "eat" || (u.action === "watch" && u.tv !== u.objectId) ? "sit" : u.action === "cuddle" ? "sleep" : (u.action as Action);
const together = (u: Use | null | undefined) => isTogether(u?.action);

/** How close together each thing is done: each stands this far from the middle (metres). */
const GAP: Record<keyof typeof TOGETHER_MS, number> = {
  hug: 0.23,
  kiss: 0.21,
  highfive: 0.36,
  dance: 0.5,
  slowdance: 0.2,
  tickle: 0.28,
  joke: 0.45,
  talk: 0.5,
  backrub: 0.3,
};
/** Quick things that are over by themselves after a while. */
const brief = (u: Use | null | undefined) => u?.action === "toilet" || u?.action === "wash";
/** Dancing where they stood, rather than on a dance floor: not kept when the house is saved. */
const dancingInPlace = (u: Use | null | undefined) => u?.action === "groove" && !u.objectId;

const center = ([x, z]: Cell): [number, number] => [x + 0.5, z + 0.5];
/** The middle of a cell on a floor, as a path point (no height on the ground floor, as it always was). */
const middle = ([x, z, l]: Spot): Point => (l ? [x + 0.5, z + 0.5, l * STOREY] : [x + 0.5, z + 0.5]);
/** A point standing in the middle of a cell, on a floor (not on stairs, or at their edge). */
const atCell = (p: Point) => Math.abs((p[0] % 1) - 0.5) < 1e-6 && Math.abs((p[1] % 1) - 0.5) < 1e-6 && Math.abs((p[2] ?? 0) - levelOf(p) * STOREY) < 1e-6;
/** Slots on a floor, saying which. */
type Slot = PlacedSlot & { level?: number };
const on = (slots: PlacedSlot[], level: number): Slot[] => slots.map((s) => ({ ...s, level }));
/** Walking freely: the furthest one step can go, and how close to a wall the middle of you can get. */
const MOVE_MAX = 1.2;
const BODY_R = 0.3;

/** The facing (quarter turns) closest to a direction. */
function rotToward(dx: number, dz: number): Rot {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz >= 0 ? 0 : 2;
}

export class Life {
  /**
   * Members connected right now. Without free will only they're in the house (a meal waits for someone who dropped
   * out); with it, everyone's character carries on while anyone's here.
   */
  online: Set<string> | null = null;
  /** Characters looking after themselves (autonomy.ts); off until the server turns it on. */
  freeWill: FreeWill | null = null;
  /** Whose order is being carried out: characters acting on their own give way to them. */
  private yieldFor: string | null = null;

  constructor(
    public state: LifeState,
    private cat: Catalog = defaultCatalog,
    private makeId: () => string = newId,
    private random: () => number = Math.random,
  ) {}

  /** Let characters look after themselves when their player is away or leaves them be. */
  enableFreeWill(): this {
    this.freeWill ??= new FreeWill(this, this.cat, this.random);
    return this;
  }

  /**
   * Is this member's character in the house right now: needs running, able to cook, there to be hugged? Everyone
   * who's connected, and with free will everyone at all while anyone's here; nobody when the house is empty.
   */
  present(memberId: string): boolean {
    if (!this.online) return true;
    return this.freeWill ? this.online.size > 0 : this.online.has(memberId);
  }

  /**
   * A player tells their character to do something. It's theirs again straight away: free will steps back, and
   * anyone acting on their own who's in the way (in the seat, at the console, on the last of the plate) gets up.
   */
  command(memberId: string, bp: Blueprint, now: number, order: () => LifeReject | null): LifeReject | null {
    this.freeWill?.noteInput(memberId, now);
    this.yieldFor = memberId;
    let r: LifeReject | null;
    try {
      r = order();
    } finally {
      this.yieldFor = null;
    }
    const a = this.state.avatars[memberId];
    if (r === null && a) {
      delete a.auto;
      this.makeWay(a, bp, now);
    }
    return r;
  }

  /** Does `o` (acting on their own) step aside for whoever's giving an order? */
  private givesWay(o: Avatar, to: string) {
    return this.yieldFor === to && o.memberId !== to && Boolean(o.auto);
  }

  /** Characters acting on their own get out of the way of what `a` was just told to do. */
  private makeWay(a: Avatar, bp: Blueprint, now: number) {
    const u = a.use;
    if (!u) return;
    const others = Object.values(this.state.avatars).filter((o) => o !== a && o.use);
    const dish = u.dishId ? this.state.dishes.find((d) => d.id === u.dishId) : undefined;
    const eaters = others.filter((o) => o.use!.dishId === u.dishId).length + 1;
    const console = this.find(bp, u.consoleId)?.o;
    const controllers = console ? slotsOf(console, "play", this.cat).length : 0;
    let gaming = others.filter((o) => o.use!.consoleId === u.consoleId).length + 1;
    for (const o of others) {
      if (!o.auto) continue;
      const ou = o.use!;
      const seat = u.objectId !== null && ou.objectId === u.objectId && ou.slot === u.slot;
      const plate = Boolean(dish) && ou.dishId === u.dishId && eaters > dish!.portions;
      const pad = Boolean(console) && ou.consoleId === u.consoleId && gaming > controllers;
      if (!seat && !plate && !pad) continue;
      if (pad) gaming--;
      this.stop(o.memberId, now);
      delete o.auto;
      this.freeWill?.later(o.memberId, now + 1500);
    }
  }

  /** An object anywhere in the house, with the floor it's on. */
  private find(bp: Blueprint, id: string | null | undefined): { o: PlacedObject; index: number; level: Level } | null {
    if (!id) return null;
    for (let i = 0; i < bp.levels.length; i++) {
      const o = bp.levels[i]!.objects[id];
      if (o) return { o, index: i, level: bp.levels[i]! };
    }
    return null;
  }

  /** Every slot for an action, on every floor. */
  private everywhere(bp: Blueprint, slots: (level: Level) => PlacedSlot[]): Slot[] {
    return bp.levels.flatMap((l, i) => on(slots(l), i));
  }

  /** Make sure a member has a character, starting at the street end of the lot. */
  ensureAvatar(memberId: string, bp: Blueprint, now: number): boolean {
    if (this.state.avatars[memberId]) return false;
    const nav = buildNav(bp, 0, this.cat);
    const others = new Set(Object.values(this.state.avatars).map((a) => cellOf(a).join(":")));
    let spot = nearestWalkable(nav, [Math.floor(bp.lot.w / 2), bp.lot.d - 1]) ?? [0, 0];
    if (others.has(spot.join(":")))
      spot = nearestWalkable({ ...nav, blocked: Uint8Array.from(nav.blocked, (b, i) => (i === spot[1] * nav.w + spot[0] ? 1 : b)) }, spot) ?? spot;
    this.state.avatars[memberId] = { memberId, path: [center(spot)], startedAt: now, face: 2, use: null, needs: { v: { ...START_NEEDS }, at: now, live: true } };
    return true;
  }

  /**
   * Write down everyone's needs as they stand now, before anything changes what they're doing (and so how their
   * needs go from here): see `CHANGES` below. True if anyone's started or stopped running down (they came or went).
   */
  settle(now: number): boolean {
    let changed = false;
    for (const a of Object.values(this.state.avatars)) {
      const live = this.present(a.memberId);
      if (a.needs?.live !== live) changed = true;
      const v = needsAt(a, now);
      for (const k in v) v[k as keyof typeof v] = Math.round(v[k as keyof typeof v] * 100) / 100;
      a.needs = { v, at: now, live };
    }
    return changed;
  }

  /**
   * Where a character can start a new walk from without jumping: the cell they're stepping into, on its floor. Part
   * way up or down stairs, they finish the flight first: `on` is the rest of the way there (before that cell).
   */
  private origin(a: Avatar, now: number) {
    const p = positionAt(a, now);
    const at: Point = p.y ? [p.x, p.z, p.y] : [p.x, p.z];
    let k = Math.min(p.next, a.path.length - 1);
    while (k < a.path.length - 1 && !atCell(a.path[k]!)) k++;
    const target = a.path[k]!;
    return { at, on: a.path.slice(Math.min(p.next, k), k), to: target, cell: [Math.floor(target[0]), Math.floor(target[1]), levelOf(target)] as Spot };
  }

  /** The points to walk through along a route: the middle of each cell, and every step of any stairs between. */
  private pointsFor(bp: Blueprint, route: Spot[]): Point[] {
    const out: Point[] = [];
    route.forEach((s, i) => {
      const prev = route[i - 1];
      if (prev && prev[2] !== s[2]) out.push(...(linkBetween(bp, prev, s, this.cat)?.via ?? []));
      out.push(middle(s));
    });
    return out;
  }

  /**
   * Doing something else ends what you were doing with your partner, for them too: a hug or kiss stops, and
   * cuddling turns back into sleeping side by side.
   */
  private letGo(a: Avatar) {
    const p = a.use?.with ? this.state.avatars[a.use.with] : undefined;
    if (!p || p.use?.with !== a.memberId) return;
    if (p.use.action === "cuddle") p.use = { ...p.use, action: "sleep", with: undefined };
    else {
      if (p.use.pose) p.face = p.use.pose.face;
      p.use = null;
    }
  }

  /** Walk a character to the nearest of `goals` (on any floor), to do `use` when they get there. */
  private walkTo(a: Avatar, bp: Blueprint, goals: Spot[], use: Use | null, now: number): LifeReject | null {
    if (a.use?.ride?.on) return "in-lift";
    const o = this.origin(a, now);
    const route = findRoute(bp, o.cell, goals, this.cat);
    if (!route) return "unreachable";
    this.letGo(a);
    // a lift on the way: walk to its doors and wait for it there; the rest of the way comes after the ride
    let cut = route.length;
    let lift: string | undefined;
    for (let i = 1; i < route.length && !lift; i++) {
      if (route[i - 1]![2] === route[i]![2]) continue;
      lift = linkBetween(bp, route[i - 1]!, route[i]!, this.cat)?.lift;
      if (lift) cut = i;
    }
    const points = [...o.on, ...this.pointsFor(bp, route.slice(0, cut))];
    const first = points[0]!;
    if (Math.hypot(first[0] - o.at[0], first[1] - o.at[1], (first[2] ?? 0) - (o.at[2] ?? 0)) > 1e-3) points.unshift(o.at);
    a.path = points;
    a.startedAt = now;
    if (points.length > 1) {
      const [x0, z0] = points[points.length - 2]!;
      const [x1, z1] = points[points.length - 1]!;
      a.face = rotToward(x1 - x0, z1 - z0);
    }
    a.use = use;
    if (lift) this.waitFor(a, bp, lift, route[cut]![2], { goals, use });
    return null;
  }

  /** Wait at a lift's doors (where the walk ends) to ride it to floor `to`, then carry on with `then`. */
  private waitFor(a: Avatar, bp: Blueprint, lift: string, to: number, then?: Ride["then"]) {
    a.use = { objectId: lift, action: "ride", slot: 0, pose: null, ride: { lift, to, ...(then ? { then, due: arrivalTime(a) } : {}) } };
    const shaft = liftsIn(bp, this.cat).find(({ o }) => o.id === lift)?.shaft;
    if (shaft) a.face = rotToward(-shaft.face[0], -shaft.face[1]);
  }

  /** What a character is setting out to do: after the lift, if they're taking it on the way. */
  private target(a: Avatar): Use | null {
    return a.use?.ride?.then ? a.use.ride.then.use : a.use;
  }

  /** Is this slot used (or about to be) by someone else? */
  private taken(s: Pick<PlacedSlot, "objectId" | "slot">, memberId: string) {
    return Object.values(this.state.avatars).some(
      (o) => o.memberId !== memberId && !this.givesWay(o, memberId) && this.target(o)?.objectId === s.objectId && this.target(o)?.slot === s.slot,
    );
  }

  /** Send a character to the free slot (of several, on any floor) that's quickest to reach. */
  private goUse(a: Avatar, bp: Blueprint, slots: Slot[], now: number, extra: Partial<Use> = {}): LifeReject | null {
    const free = slots.filter((s) => !this.taken(s, a.memberId));
    if (!slots.length) return "nothing-to-do";
    if (!free.length) return "taken";
    const from = this.origin(a, now).cell;
    let best: { s: Slot; cells: Spot[] } | null = null;
    for (const s of free) {
      const L = s.level ?? 0;
      const spots = (cells: Cell[]): Spot[] => cells.map(([x, z]) => [x, z, L]);
      const cells = findRoute(bp, from, spots(s.stand), this.cat) ?? findRoute(bp, from, spots(s.around), this.cat);
      if (cells && (!best || cells.length < best.cells.length)) best = { s, cells };
    }
    if (!best) return "unreachable";
    const { s } = best;
    const r = this.walkTo(
      a,
      bp,
      [best.cells[best.cells.length - 1]!],
      { objectId: s.objectId, action: s.action, slot: s.slot, station: s.station, pose: s.pose, ...extra },
      now,
    );
    if (!r && s.seconds) this.target(a)!.until = arrivalTime(a) + s.seconds * 1000;
    return r;
  }

  /** Walk to a cell, on a floor (the one they're on, if not said). */
  walk(memberId: string, bp: Blueprint, cell: Cell, now: number, level?: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const L = level ?? (a ? this.origin(a, now).cell[2] : 0);
    if (!a || !bp.levels[L]) return "unreachable";
    const nav = buildNav(bp, L, this.cat);
    const goal = walkable(nav, cell[0], cell[1]) ? cell : nearestWalkable(nav, cell);
    if (!goal) return "unreachable";
    return this.walkTo(a, bp, [[goal[0], goal[1], L]], null, now);
  }

  use(memberId: string, bp: Blueprint, objectId: string, action: Action, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const found = this.find(bp, objectId);
    if (!a || !found) return "nothing-to-do";
    const { o, index } = found;
    if (action === "watch") return this.watch(a, bp, o.id, now);
    if (action === "play") return this.play(a, bp, o.id, now);
    if (action === "pingpong" || action === "blackjack") {
      const nav = buildNav(bp, index, this.cat);
      const slots = slotsOf(o, action, this.cat);
      if (!slots.length) return "nothing-to-do";
      const reachable = slots.filter((s) => roomAt(nav, s.pose.x, s.pose.z, BODY_R)).map((s) => ({ ...s, around: [] }));
      return reachable.length ? this.goUse(a, bp, on(reachable, index), now) : "unreachable";
    }
    return this.goUse(a, bp, on(slotsOf(o, action, this.cat), index), now);
  }

  /**
   * Dance: on a dance-floor tile (`objectId`), or right where you are. Already dancing there, it just changes the
   * dance. Starting one ends whatever you were doing (a seat, the stove, the sink) like any other order.
   */
  dance(memberId: string, bp: Blueprint, objectId: string | null, move: string, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    if (!a || !isDance(move)) return "nothing-to-do";
    if (a.use?.ride?.on) return "in-lift";
    if (objectId) {
      const found = this.find(bp, objectId);
      if (!found || !slotsOf(found.o, "groove", this.cat).length) return "nothing-to-do";
      if (a.use?.action === "groove" && a.use.objectId === objectId) {
        a.use = { ...a.use, move };
        return null;
      }
      return this.goUse(a, bp, on(slotsOf(found.o, "groove", this.cat), found.index), now, { move });
    }
    if (a.use?.action === "groove") {
      a.use = { ...a.use, move };
      return null;
    }
    this.stop(memberId, now);
    // right here: where the walk (if they were walking) ends
    const end = a.path[a.path.length - 1]!;
    a.use = { objectId: null, action: "groove", slot: 0, pose: { x: end[0], z: end[1], y: 0, face: a.face }, move };
    return null;
  }

  /** A member of the house works the party panel: the lights, or the shared music. Not an order to anyone's character. */
  party(memberId: string, bp: Blueprint, cmd: PartyCmd, now: number, gear = partyGear(bp, this.cat)) {
    return applyParty(this.state, cmd, { memberId, now, newId: this.makeId, gear });
  }

  /** Card choices belong to an arrived table participant and the round currently visible to them. */
  cards(memberId: string, bp: Blueprint, objectId: string, roundId: string | null, command: BlackjackCommand, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const table = this.find(bp, objectId)?.o;
    if (!a || !table || !slotsOf(table, "blackjack", this.cat).length || a.use?.action !== "blackjack" || a.use.objectId !== objectId || activityAt(a, now) !== "blackjack") return "not-at-table";
    const round = this.state.blackjack?.[objectId];
    if ((round?.id ?? null) !== roundId) return "round-changed";
    if (command === "deal") {
      if (round?.phase === "playing") return "round-active";
      const players = Object.values(this.state.avatars)
        .filter((p) => p.use?.action === "blackjack" && p.use.objectId === objectId && this.isHere(p.memberId))
        .sort((a, b) => a.use!.slot - b.use!.slot);
      if (players.some((p) => activityAt(p, now) !== "blackjack")) return "not-at-table";
      this.state.blackjack ??= {};
      const dealt = dealBlackjack(this.makeId(), players.map((p) => p.memberId), this.random);
      for (const player of players) dealt.hands[player.memberId]!.seat = player.use!.slot;
      this.state.blackjack[objectId] = dealt;
      return null;
    }
    if (!round || !playBlackjack(round, memberId, command, this.random)) return "round-over";
    return null;
  }

  /** Leaving a table or losing a partner never leaves an unfinishable round behind. Empty houses pause. */
  syncTableGames(bp: Blueprint): boolean {
    let changed = false;
    for (const [tableId, round] of Object.entries(this.state.blackjack ?? {})) {
      const table = this.find(bp, tableId)?.o;
      if (!table || !slotsOf(table, "blackjack", this.cat).length) {
        delete this.state.blackjack![tableId];
        changed = true;
        continue;
      }
      if (round.phase !== "playing") continue;
      for (const [id, hand] of Object.entries(round.hands)) {
        if (hand.status !== "playing") continue;
        const use = this.state.avatars[id]?.use;
        if (use?.action !== "blackjack" || use.objectId !== tableId) { hand.status = "left"; changed = true; }
        else if (this.online?.size && !this.online.has(id)) { hand.status = "stood"; changed = true; }
      }
      if (finishBlackjack(round, this.random)) changed = true;
    }
    return changed;
  }

  /** Reserve a controller and a seat facing the console's nearest TV, falling back to an open floor spot. */
  private play(a: Avatar, bp: Blueprint, objectId: string, now: number): LifeReject | null {
    const { level, index } = this.find(bp, objectId)!;
    const console = level.objects[objectId]!;
    const controllers = slotsOf(console, "play", this.cat).length;
    if (!controllers) return "nothing-to-do";
    const used = Object.values(this.state.avatars).filter(
      (other) => other.memberId !== a.memberId && !this.givesWay(other, a.memberId) && other.use?.consoleId === console.id,
    ).length;
    if (used >= controllers) return "taken";
    const nav = buildNav(bp, index, this.cat);
    const spots = gamingSpots(level, console, nav, this.cat);
    if (!spots) return "no-tv";
    const extra: Partial<Use> = { action: "play", tv: spots.tv.id, consoleId: console.id };
    const seated = spots.seats.length ? this.goUse(a, bp, on(spots.seats, index), now, extra) : "nothing-to-do";
    if (!seated) return null;
    if (spots.floor.length) return this.goUse(a, bp, on(spots.floor, index), now, extra);
    return seated === "nothing-to-do" ? "unreachable" : seated;
  }

  /**
   * Watch TV: picked from the TV, you go to the closest free seat with a view of it, or sit on the floor in front
   * if there's none; picked from a seat, you sit there and watch the TV it faces.
   */
  private watch(a: Avatar, bp: Blueprint, objectId: string, now: number): LifeReject | null {
    const { level, index } = this.find(bp, objectId)!;
    const o = level.objects[objectId]!;
    const isTv = Boolean(screenOf(o, this.cat));
    const seats = isTv ? seatsFacing(level, o, this.cat) : slotsOf(o, "sit", this.cat).filter((s) => tvFacing(level, s, this.cat));
    const r: LifeReject | null = seats.length ? this.goUse(a, bp, on(seats, index), now, { action: "watch" }) : "no-tv";
    if (!r) {
      const u = this.target(a)!;
      const seat = seats.find((s) => s.objectId === u.objectId && s.slot === u.slot)!;
      u.tv = isTv ? o.id : tvFacing(level, seat, this.cat)!.id;
      return null;
    }
    if (isTv) {
      const floor = this.goUse(a, bp, on(slotsOf(o, "watch", this.cat), index), now, { tv: o.id });
      if (!floor || !seats.length) return floor;
    }
    return r;
  }

  /**
   * Walk freely, a step at a time (first person): straight towards a spot close by, sliding along walls and
   * furniture rather than through them. Getting up from a seat first if you're on one.
   */
  move(memberId: string, bp: Blueprint, to: [number, number], now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    if (!a) return "unreachable";
    if (a.use?.ride?.on) return null;
    const p = positionAt(a, now);
    const seated = a.use?.pose && p.next >= a.path.length;
    // from a seat you get up where you sat down from
    const here: Point = seated ? a.path[a.path.length - 1]! : p.y ? [p.x, p.z, p.y] : [p.x, p.z];
    const L = levelOf(here);
    // part way up or down stairs, you keep going to the end of the flight
    if (Math.abs((here[2] ?? 0) - L * STOREY) > 1e-3) return null;
    const nav = buildNav(bp, L, this.cat);
    const from: [number, number] = [here[0], here[1]];
    let [dx, dz] = [to[0] - from[0], to[1] - from[1]];
    const len = Math.hypot(dx, dz);
    if (len > MOVE_MAX) [dx, dz] = [(dx / len) * MOVE_MAX, (dz / len) * MOVE_MAX];
    // heading into stairs from the cell at their foot (or head): up (or down) the whole flight
    const flight = len > 0.05 && this.stairsAhead(bp, here, dx, dz);
    const end = slide(nav, from, [from[0] + dx, from[1] + dz], BODY_R);
    const moved = Math.hypot(end[0] - from[0], end[1] - from[1]) > 0.01;
    if (!flight && !moved && !a.use && p.next >= a.path.length) return "unreachable";
    this.letGo(a);
    if (a.use?.pose) a.face = a.use.pose.face;
    a.use = null;
    const y = (q: [number, number]): Point => (L ? [q[0], q[1], L * STOREY] : q);
    a.path = flight ? [here, ...flight] : moved ? [here, y(end)] : [here];
    a.startedAt = now;
    if (flight) {
      const [x0, z0] = flight[0]!;
      const [x1, z1] = flight[flight.length - 1]!;
      a.face = rotToward(x1 - x0, z1 - z0);
      return null;
    }
    // a little shuffle (stopping where you are) doesn't turn you round
    if (Math.hypot(end[0] - from[0], end[1] - from[1]) > 0.15) a.face = rotToward(end[0] - from[0], end[1] - from[1]);
    return null;
  }

  // --- lifts ---

  /** Take a lift to floor `to`: walk to its doors on the floor you're on, call it, and ride. */
  ride(memberId: string, bp: Blueprint, liftId: string, to: number, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    if (!a) return "unreachable";
    if (a.use?.ride?.on) return "in-lift";
    const stops = liftStops(bp, liftId, this.cat);
    const here = this.origin(a, now).cell[2];
    const from = stops.find((s) => s.level === here);
    if (!from || !stops.some((s) => s.level === to)) return "unreachable";
    if (to === here) return "nothing-to-do";
    const r = this.walkTo(a, bp, [[...from.at, here]], null, now);
    if (r) return r;
    this.waitFor(a, bp, liftId, to);
    return null;
  }

  /**
   * Run the lifts up to `now`: cars arrive and open their doors, people waiting call them and get on, riders get
   * off at their floor (and carry on where they were going), and a car with somewhere to be closes up and sets off.
   */
  private runLifts(bp: Blueprint, now: number): boolean {
    const lifts = liftsIn(bp, this.cat);
    if (!lifts.length) return false;
    const cars = (this.state.lifts ??= {});
    let changed = false;
    for (const { o, shaft } of lifts) {
      const car = (cars[o.id] ??= { level: 0, stops: [] });
      const stops = new Set(liftStops(bp, o.id, this.cat).map((s) => s.level));
      for (let step = 0; step < 8; step++) {
        const did = this.liftStep(bp, o.id, shaft, car, stops, now);
        if (!did) break;
        changed = true;
      }
    }
    return changed;
  }

  /** One thing a lift does next, if anything's due. */
  private liftStep(bp: Blueprint, id: string, shaft: Shaft, car: Lift, stops: Set<number>, now: number): boolean {
    const riders = Object.values(this.state.avatars).filter((a) => a.use?.ride?.lift === id);
    const call = (level: number) => {
      if (car.stops.includes(level) || (!car.move && car.level === level && car.open !== undefined && now < car.open)) return false;
      car.stops.push(level);
      return true;
    };
    // the car gets there and opens up
    if (car.move && now >= car.move.arrives) {
      car.level = car.move.to;
      car.open = Math.max(car.move.arrives, now - LIFT_OPEN_MS / 2) + LIFT_OPEN_MS;
      delete car.move;
      car.stops = car.stops.filter((l) => l !== car.level);
      return true;
    }
    const open = !car.move && car.open !== undefined && now < car.open;
    if (open) {
      // off at their floor (or wherever it's stopped, if theirs has gone)
      const off = riders.find((a) => a.use!.ride!.on && (a.use!.ride!.to === car.level || !stops.has(a.use!.ride!.to)));
      if (off) {
        this.stepOut(off, bp, shaft, car.level, now);
        car.open = Math.max(car.open!, now + 900);
        return true;
      }
      // on, if there's room
      const taken = new Set(riders.filter((a) => a.use!.ride!.on).map((a) => a.use!.slot));
      const on = riders.find((a) => !a.use!.ride!.on && now >= arrivalTime(a) && floorOf(a) === car.level && a.use!.ride!.to !== car.level);
      const slot = shaft.spots.findIndex((_, i) => !taken.has(i));
      if (on && slot >= 0) {
        const r = on.use!.ride!;
        const [x, z] = shaft.spots[slot]!;
        const y = car.level * STOREY;
        const p = positionAt(on, now);
        on.path = [y ? [p.x, p.z, y] : [p.x, p.z], y ? [x, z, y] : [x, z]];
        on.startedAt = now;
        on.face = rotToward(shaft.face[0], shaft.face[1]);
        on.use = { ...on.use!, slot, ride: { ...r, on: true } };
        if (stops.has(r.to)) call(r.to);
        car.open = Math.max(car.open!, arrivalTime(on) + 700);
        return true;
      }
    }
    // waiting at the doors (or riding, after a reload): press the button
    let pressed = false;
    for (const a of riders) {
      const r = a.use!.ride!;
      if (r.on) pressed = (stops.has(r.to) && r.to !== car.level && call(r.to)) || pressed;
      else if (now >= arrivalTime(a) && stops.has(floorOf(a))) pressed = call(floorOf(a)) || pressed;
    }
    if (pressed) return true;
    if (car.move || open) return false;
    // stopped with the doors shut: open up for this floor, or set off for the next one asked for
    if (car.stops.includes(car.level)) {
      car.stops = car.stops.filter((l) => l !== car.level);
      car.open = now + LIFT_OPEN_MS;
      return true;
    }
    car.stops = car.stops.filter((l) => stops.has(l));
    const first = car.stops[0];
    if (first === undefined) return false;
    // on the way to the first, stop at any others asked for that it passes
    const up = first > car.level;
    const to = car.stops.filter((l) => (up ? l > car.level && l <= first : l < car.level && l >= first)).sort((x, y) => Math.abs(x - car.level) - Math.abs(y - car.level))[0]!;
    const departs = now + LIFT_DOOR_MS;
    car.move = { from: car.level, to, departs, arrives: departs + Math.abs(to - car.level) * LIFT_FLOOR_MS };
    delete car.open;
    return true;
  }

  /** Out of the lift onto floor `level`, and on to wherever they were going after. */
  private stepOut(a: Avatar, bp: Blueprint, shaft: Shaft, level: number, now: number) {
    const u = a.use!;
    const r = u.ride!;
    const here = a.path[a.path.length - 1]!;
    // out through the nearer door, if there's floor there (riders side by side don't end up on top of each other)
    const nav = buildNav(bp, level, this.cat);
    const doors = shaft.front.filter(([x, z]) => walkable(nav, x, z)).sort((p, q) => Math.hypot(p[0] + 0.5 - here[0], p[1] + 0.5 - here[1]) - Math.hypot(q[0] + 0.5 - here[0], q[1] + 0.5 - here[1]));
    const out = doors[0] ?? liftStops(bp, r.lift, this.cat).find((s) => s.level === level)?.at ?? shaft.front[0]!;
    const y = level * STOREY;
    a.path = [y ? [here[0], here[1], y] : [here[0], here[1]], middle([...out, level])];
    a.startedAt = now;
    a.use = null;
    if (!r.then) return;
    const next = r.then.use && { ...r.then.use };
    if (this.walkTo(a, bp, r.then.goals, next, now) || !next || r.due === undefined) return;
    // whatever's timed from getting there (a plate, a quick wash) is as late as the ride made it
    const late = arrivalTime(a) - r.due;
    if (next.until !== undefined) next.until += late;
    if (next.startsAt !== undefined) next.startsAt += late;
  }

  /** The car of a lift, as it is now. */
  lift(id: string): Lift | undefined {
    return this.state.lifts?.[id];
  }

  /**
   * Stairs just ahead of someone standing at `here` and heading (dx, dz): the way up or down them, to the middle of
   * the cell at the other end. Only from the cell right at their foot or head, and heading more or less into them.
   */
  private stairsAhead(bp: Blueprint, here: Point, dx: number, dz: number): Point[] | null {
    const spot: Spot = [Math.floor(here[0]), Math.floor(here[1]), levelOf(here)];
    const len = Math.hypot(dx, dz);
    for (const l of linksOf(bp, this.cat).get(`${spot[2]}:${spot[0]}:${spot[1]}`) ?? []) {
      const [ex, ez] = l.via[0]!;
      const [ox, oz] = [ex - here[0], ez - here[1]];
      const dist = Math.hypot(ox, oz);
      if (dist < 0.8 && (ox * dx + oz * dz) / (dist * len || 1) > 0.75) return [...l.via, middle(l.to)];
    }
    return null;
  }

  /** Stand still (getting up if sitting), stopping at the next cell if walking (at the end of the flight, on stairs). */
  stop(memberId: string, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    if (!a) return "nothing-to-do";
    // in a lift you ride it to the floor you asked for, and stay there
    if (a.use?.ride?.on) {
      a.use = { ...a.use, ride: { lift: a.use.ride.lift, to: a.use.ride.to, on: true } };
      return null;
    }
    const p = positionAt(a, now);
    if (p.next < a.path.length) {
      const o = this.origin(a, now);
      a.path = [o.at, ...o.on, o.to];
      a.startedAt = now;
    }
    this.letGo(a);
    if (a.use?.pose) a.face = a.use.pose.face;
    a.use = null;
    return null;
  }

  // --- together ---

  private isHere(memberId: string) {
    return this.present(memberId);
  }

  /**
   * Do something with your partner face to face (a hug, a dance, a joke: you go to them), or cuddle up when you're
   * both in the same bed.
   */
  social(memberId: string, bp: Blueprint, action: Social, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const p = Object.values(this.state.avatars).find((o) => o.memberId !== memberId);
    if (!a) return "nothing-to-do";
    if (!p || !this.isHere(p.memberId)) return "partner-away";
    if (a.use?.ride?.on) return "in-lift";
    if (p.use?.ride?.on) return "partner-busy";

    if (action === "cuddle" || action === "uncuddle") {
      const bed = a.use?.objectId;
      const inBed = (u: Use | null) => u?.objectId === bed && (u?.action === "sleep" || u?.action === "cuddle");
      if (!bed || !inBed(a.use) || !inBed(p.use) || now < arrivalTime(a) || now < arrivalTime(p)) return "not-in-bed";
      const to = action === "cuddle" ? "cuddle" : "sleep";
      a.use = { ...a.use!, action: to, with: to === "cuddle" ? p.memberId : undefined };
      p.use = { ...p.use!, action: to, with: to === "cuddle" ? a.memberId : undefined };
      return null;
    }

    // a sitter gets up for a hug; someone cooking, eating or asleep is busy, unless they're only at it of their own accord
    if (p.use && !this.givesWay(p, memberId) && !together(p.use) && p.use.action !== "sit" && p.use.action !== "lounge" && p.use.action !== "watch" && p.use.action !== "play") return "partner-busy";
    // they stop where they are (the cell they're stepping into); you go beside them, with no wall in between
    const [px, pz, pl] = this.origin(p, now).cell;
    const nav = buildNav(bp, pl, this.cat);
    const beside: Spot[] = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (walkable(nav, px + dx, pz + dz) && canStep(nav, px, pz, px + dx, pz + dz)) beside.push([px + dx, pz + dz, pl]);
    const route = beside.length ? findRoute(bp, this.origin(a, now).cell, beside, this.cat) : null;
    // (not by lift: you'd keep them waiting at the doors for the ride)
    if (!route || route.some((s, i) => i > 0 && s[2] !== route[i - 1]![2] && linkBetween(bp, route[i - 1]!, s, this.cat)?.lift)) return "unreachable";
    this.stop(p.memberId, now);
    this.walkTo(a, bp, beside, null, now);

    // close together, facing each other, halfway between the two cells
    const [ax, az] = cellOf(a);
    const mx = (ax + px) / 2 + 0.5;
    const mz = (az + pz) / 2 + 0.5;
    const gap = GAP[action];
    const startsAt = Math.max(arrivalTime(a), arrivalTime(p));
    const until = startsAt + TOGETHER_MS[action];
    const settle = (who: Avatar, other: Avatar, dx: number, dz: number, at: number, face: Rot, lead: boolean) => {
      who.face = face;
      who.use = { objectId: null, action, slot: 0, pose: { x: mx + dx * at, z: mz + dz * at, y: 0, face }, with: other.memberId, startsAt, until };
      if (lead) who.use.lead = true;
    };
    // a back rub: you stand behind them, both facing the same way; anything else is face to face
    const [dx, dz] = [px - ax, pz - az];
    if (action === "backrub") {
      settle(a, p, dx, dz, -0.3, rotToward(dx, dz), true);
      settle(p, a, dx, dz, 0.02, rotToward(dx, dz), false);
    } else {
      settle(a, p, dx, dz, -gap, rotToward(dx, dz), true);
      settle(p, a, dx, dz, gap, rotToward(-dx, -dz), false);
    }
    return null;
  }

  // --- cooking ---

  private sendToStation(a: Avatar, bp: Blueprint, station: Station, now: number, objectId: string | null = null) {
    const found = this.find(bp, objectId);
    const own = found ? on(slotsOf(found.o, undefined, this.cat).filter((s) => s.station === station), found.index) : [];
    if (own.length && this.goUse(a, bp, own, now) === null) return null;
    return this.goUse(a, bp, this.everywhere(bp, (l) => stationSlots(l, station, this.cat)), now);
  }

  cook(memberId: string, bp: Blueprint, recipeId: string, objectId: string | null, now: number): LifeReject | null {
    const recipe = this.cat.recipes.get(recipeId);
    const a = this.state.avatars[memberId];
    if (!recipe || !a) return "unknown-recipe";
    if (this.state.cooking) return "already-cooking";
    if (recipe.steps.some((s) => this.everywhere(bp, (l) => stationSlots(l, s.station, this.cat)).length === 0)) return "no-kitchen";
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
    return Object.values(this.state.avatars).filter((a) => a.use?.station && now >= arrivalTime(a) && this.present(a.memberId));
  }

  // --- eating ---

  eat(memberId: string, bp: Blueprint, dishId: string, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const dish = this.state.dishes.find((d) => d.id === dishId);
    if (!a || !dish) return "no-dish";
    const eating = Object.values(this.state.avatars).filter((o) => o.memberId !== memberId && !this.givesWay(o, memberId) && o.use?.dishId === dishId).length;
    if (eating >= dish.portions) return "taken";
    const L = dish.level ?? 0;
    const level = bp.levels[L];
    if (!level) return "no-dish";
    // a seat at the plate's table if there is one, otherwise stand by the plate
    const table = dish.surfaceId ? level.objects[dish.surfaceId] : undefined;
    const item = table && this.cat.furniture.get(table.catalogId);
    const f = table && item ? footprintOf(item, table) : { x: dish.x, z: dish.z, w: 0, d: 0 };
    const gap = (x: number, z: number) => Math.hypot(Math.max(f.x - x, 0, x - f.x - f.w), Math.max(f.z - z, 0, z - f.z - f.d));
    const seats: PlacedSlot[] = [];
    for (const o of Object.values(level.objects)) for (const s of slotsOf(o, "sit", this.cat)) if (gap(s.pose.x, s.pose.z) < 0.9) seats.push(s);
    if (seats.length && this.goUse(a, bp, on(seats, L), now, { action: "eat", dishId }) === null) {
      this.target(a)!.until = arrivalTime(a) + EAT_MS;
      return null;
    }
    const dc: Cell = [Math.floor(dish.x), Math.floor(dish.z)];
    const around: Spot[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) around.push([dc[0] + dx, dc[1] + dz, L]);
    const r = this.walkTo(a, bp, around, { objectId: null, action: "eat", slot: 0, pose: null, dishId }, now);
    if (r) return r;
    const end = a.path[a.path.length - 1]!;
    a.face = rotToward(dish.x - end[0], dish.z - end[1]);
    this.target(a)!.until = arrivalTime(a) + EAT_MS;
    return null;
  }

  private serve(bp: Blueprint, recipeId: string, near: { x: number; z: number; level: number }, now: number, portions = this.cat.recipes.get(recipeId)?.serves ?? 1): Dish {
    const level = bp.levels[near.level] ?? bp.levels[0]!;
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
    const dish: Dish = {
      id: this.makeId(),
      recipeId,
      x: spot.x + (already % 2 ? 0.45 : -0.45) * Math.ceil(already / 2),
      z: spot.z,
      surfaceId: spot.id,
      portions,
      servedAt: now,
      ...(near.level && bp.levels[near.level] ? { level: near.level } : {}),
    };
    this.state.dishes.push(dish);
    // too many plates out: the oldest one nobody's eating goes in the fridge (or, with no fridge, away)
    while (this.state.dishes.length > MAX_DISHES) {
      const i = this.state.dishes.findIndex((d) => d !== dish && !this.beingEaten(d));
      const [old] = this.state.dishes.splice(i < 0 ? 0 : i, 1);
      if (old && this.fridges(bp).length) this.putAway(old, now);
    }
    return dish;
  }

  // --- the fridge ---

  /** Every fridge in the house, with the floor it's on. */
  private fridges(bp: Blueprint) {
    return bp.levels.flatMap((l, level) => Object.values(l.objects).filter((o) => this.cat.furniture.get(o.catalogId)?.fridge).map((o) => ({ o, level })));
  }

  private beingEaten(d: Dish) {
    return Object.values(this.state.avatars).some((a) => a.use?.dishId === d.id);
  }

  /** Off the table and into the fridge (the oldest thing in there goes, if it's full). */
  private putAway(d: Dish, now: number) {
    this.state.dishes = this.state.dishes.filter((x) => x !== d);
    const fridge = (this.state.fridge ??= []);
    fridge.push({ id: d.id, recipeId: d.recipeId, portions: d.portions, storedAt: now });
    while (fridge.length > MAX_LEFTOVERS) fridge.shift();
  }

  /** Put a plate in the fridge for later. */
  store(bp: Blueprint, dishId: string, now: number): LifeReject | null {
    const d = this.state.dishes.find((x) => x.id === dishId);
    if (!d) return "no-dish";
    if (!this.fridges(bp).length) return "no-fridge";
    if (this.beingEaten(d)) return "taken";
    this.putAway(d, now);
    return null;
  }

  /**
   * Take a meal out of the fridge: it goes on the table nearest the fridge (the one you opened, or the nearest to you),
   * and with `eat` you sit down to it straight away.
   */
  takeOut(memberId: string, bp: Blueprint, leftoverId: string, fridgeId: string | null, eat: boolean, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const fridge = this.state.fridge ?? [];
    const i = fridge.findIndex((l) => l.id === leftoverId);
    if (!a || i < 0) return "no-dish";
    const fridges = this.fridges(bp);
    const me = positionAt(a, now);
    // the nearest, counting another floor as a good way off
    const far = ({ o, level }: { o: PlacedObject; level: number }) => Math.hypot(o.x - me.x, o.z - me.z) + Math.abs(level - floorOf(a)) * 20;
    const from = fridges.find(({ o }) => o.id === fridgeId) ?? fridges.sort((p, q) => far(p) - far(q))[0];
    if (!from) return "no-fridge";
    const item = this.cat.furniture.get(from.o.catalogId)!;
    const f = footprintOf(item, from.o);
    const [l] = fridge.splice(i, 1) as [Leftover];
    const dish = this.serve(bp, l.recipeId, { x: f.x + f.w / 2, z: f.z + f.d / 2, level: from.level }, now, l.portions);
    if (!eat) return null;
    const r = this.eat(memberId, bp, dish.id, now);
    if (r) {
      // couldn't get to it: back in the fridge as it was
      this.state.dishes = this.state.dishes.filter((d) => d !== dish);
      fridge.splice(i, 0, l);
    }
    return r;
  }

  // --- time passing ---

  /**
   * Move time forward: finish meals and plates, keep the cooking speed right, and let anyone left to themselves
   * decide what to do. True if anything changed.
   */
  tick(bp: Blueprint, now: number): boolean {
    const passed = this.passTime(bp, now);
    return (this.freeWill?.think(bp, now) ?? false) || passed;
  }

  private passTime(bp: Blueprint, now: number): boolean {
    let changed = this.runLifts(bp, now);
    changed = this.syncTableGames(bp) || changed;
    for (const a of Object.values(this.state.avatars)) {
      const u = a.use;
      if ((together(u) || brief(u)) && u!.until !== undefined && now >= u!.until) {
        if (u!.pose) a.face = u!.pose.face;
        a.use = null;
        changed = true;
        // after the toilet, wash your hands if there's a sink you can get to
        if (u!.action === "toilet") this.goUse(a, bp, this.everywhere(bp, (l) => slotsFor(l, "wash", this.cat)), now);
        continue;
      }
      if (u?.action !== "eat" || u.until === undefined || now < u.until) continue;
      const dish = this.state.dishes.find((d) => d.id === u.dishId);
      if (dish) {
        dish.portions -= 1;
        dish.servedAt = now;
        if (dish.portions <= 0) this.state.dishes = this.state.dishes.filter((d) => d !== dish);
      }
      // stay seated after eating; standing eaters just stand
      a.use = u.objectId ? { ...u, action: "sit", dishId: undefined, until: undefined } : null;
      changed = true;
    }

    // plates nobody's touched in a while go in the fridge; with no fridge (or someone at it), they wait another while
    for (const d of [...this.state.dishes]) {
      if (d.servedAt === undefined || now < d.servedAt + LEFTOVER_MS) continue;
      if (!this.beingEaten(d) && this.fridges(bp).length) this.putAway(d, now);
      else d.servedAt = now;
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
        const at = last?.use?.pose ?? (last ? { x: last.path[0]![0], z: last.path[0]![1] } : { x: bp.lot.w / 2, z: bp.lot.d / 2 });
        this.serve(bp, recipe.id, { x: at.x, z: at.z, level: last ? floorOf(last) : 0 }, now);
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
    const rate = cookingRate(
      recipe,
      c.step,
      this.workers(now).map((a) => a.use!.station!),
    );
    if (rate !== c.rate) {
      c.done = cookingDone(c, recipe, now);
      c.updatedAt = now;
      c.rate = rate;
      changed = true;
    }
    return changed;
  }

  /**
   * The next moment `tick` could change anything (a step finishing, a cook reaching their station, a last bite), or
   * null if nothing is due. The server sleeps until then instead of checking all the time.
   */
  nextEvent(now: number): number | null {
    let next = Infinity;
    for (const a of Object.values(this.state.avatars)) {
      const arrive = arrivalTime(a);
      if (a.use?.station && arrive > now) next = Math.min(next, arrive);
      if ((a.use?.action === "eat" || together(a.use) || brief(a.use)) && a.use!.until !== undefined) next = Math.min(next, a.use!.until);
    }
    for (const d of this.state.dishes) if (d.servedAt !== undefined) next = Math.min(next, d.servedAt + LEFTOVER_MS);
    // lifts: a car getting there, doors closing with somewhere to go, someone getting to the doors to call it
    for (const [id, car] of Object.entries(this.state.lifts ?? {})) {
      const riders = Object.values(this.state.avatars).some((a) => a.use?.ride?.lift === id);
      if (car.move) next = Math.min(next, car.move.arrives);
      else if (car.open !== undefined && car.open > now && (car.stops.length || riders)) next = Math.min(next, car.open);
      else if (car.stops.length || riders) next = Math.min(next, now);
    }
    for (const a of Object.values(this.state.avatars)) if (a.use?.ride && !a.use.ride.on && arrivalTime(a) > now) next = Math.min(next, arrivalTime(a));
    const c = this.state.cooking;
    const step = c && this.cat.recipes.get(c.recipeId)?.steps[c.step];
    if (c && step && c.rate > 0) next = Math.min(next, c.updatedAt + ((step.seconds - c.done) / c.rate) * 1000);
    next = Math.min(next, this.freeWill?.nextAt(now) ?? Infinity);
    return next === Infinity ? null : Math.max(next, now);
  }

  /**
   * The house changed under everyone's feet: anyone using furniture that moved or went stops, walks that are
   * now blocked find another way (or stop), anyone furniture landed on steps aside, and plates on a table that
   * went are cleared. True if anything changed.
   */
  onBlueprint(bp: Blueprint, now: number): boolean {
    let changed = this.liftsChanged(bp, now);
    for (const a of Object.values(this.state.avatars)) {
      const u = a.use;
      // riding a lift that's still there: it sees them off at a floor it still stops at
      if (u?.ride?.on) continue;
      const found = this.find(bp, u?.objectId);
      const level = found?.level ?? bp.levels[0]!;
      const nav = buildNav(bp, found?.index ?? 0, this.cat);
      if (u?.objectId && !u.ride) {
        const o = found?.o;
        const s = o ? slotsOf(o, slotAction(u), this.cat)[u.slot] : undefined;
        if (!s || !u.pose || s.pose.x !== u.pose.x || s.pose.z !== u.pose.z || s.pose.face !== u.pose.face) {
          this.letGo(a);
          if (u.pose) a.face = u.pose.face;
          a.use = null;
          changed = true;
        } else if (u.action === "play") {
          const console = u.consoleId ? level.objects[u.consoleId] : undefined;
          const spots = console && slotsOf(console, "play", this.cat).length ? gamingSpots(level, console, nav, this.cat) : null;
          const valid = spots && spots.tv.id === u.tv && [...spots.seats, ...spots.floor].some((spot) => spot.objectId === u.objectId && spot.slot === u.slot);
          if (!valid) {
            a.use = u.objectId === u.tv ? null : { ...u, action: "sit", tv: undefined, consoleId: undefined };
            changed = true;
          }
        } else if (u.action === "watch" && u.tv !== u.objectId) {
          const tv = u.tv ? level.objects[u.tv] : undefined;
          if (!tv || !canSee(s, tv, this.cat)) {
            a.use = { ...u, action: "sit", tv: undefined };
            changed = true;
          }
        }
      }
      const p = positionAt(a, now);
      if (p.next < a.path.length) {
        // still walking: is the rest of the way still open (on the flat, and up or down any stairs)?
        let open = true;
        let from: Spot | null = null;
        for (let i = Math.max(p.next - 1, 0); i < a.path.length && open; i++) {
          const q = a.path[i]!;
          if (!atCell(q) && i < a.path.length - 1) continue;
          const to: Spot = [Math.floor(q[0]), Math.floor(q[1]), levelOf(q)];
          if (from && from[2] !== to[2]) open = Boolean(linkBetween(bp, from, to, this.cat));
          else if (from && (from[0] !== to[0] || from[1] !== to[1])) {
            const n = buildNav(bp, to[2], this.cat);
            open = walkable(n, to[0], to[1]) && canStep(n, from[0], from[1], to[0], to[1]);
          }
          from = to;
        }
        if (!open) {
          // another way to the same spot, or the nearest one left if that's gone
          const L = floorOf(a);
          const n = buildNav(bp, L, this.cat);
          const goal = walkable(n, ...cellOf(a)) ? cellOf(a) : nearestWalkable(n, cellOf(a));
          if (!goal || this.walkTo(a, bp, [[...goal, L]], a.use, now)) this.stop(a.memberId, now);
          changed = true;
        }
      } else {
        // standing somewhere that's gone (or been built on): step to the nearest spot on the same floor, or downstairs
        const here = cellOf(a);
        const L = floorOf(a);
        const own = bp.levels[L] ? buildNav(bp, L, this.cat) : null;
        if (!own || !walkable(own, here[0], here[1])) {
          let to = own && nearestWalkable(own, here);
          let at = L;
          if (!to) [to, at] = [nearestWalkable(buildNav(bp, 0, this.cat), here), 0];
          if (to) {
            a.path = [p.y ? [p.x, p.z, p.y] : [p.x, p.z], middle([to[0], to[1], at])];
            a.startedAt = now;
            if (a.use?.pose) a.face = a.use.pose.face;
            this.letGo(a);
            a.use = null;
            changed = true;
          }
        }
      }
    }
    const kept: Dish[] = [];
    const gone: Dish[] = [];
    for (const d of this.state.dishes) {
      if ((d.surfaceId && !this.find(bp, d.surfaceId)) || !bp.levels[d.level ?? 0]) {
        changed = true;
        gone.push(d);
        for (const a of Object.values(this.state.avatars))
          if (a.use?.dishId === d.id) a.use = a.use.objectId ? { ...a.use, action: "sit", dishId: undefined, until: undefined } : null;
      } else kept.push(d);
    }
    this.state.dishes = kept;
    // what was on a table that went is saved in the fridge, if there's one
    if (gone.length && this.fridges(bp).length) for (const d of gone) this.putAway({ ...d }, now);
    // and with the last fridge gone, so is what was in it
    if (this.state.fridge?.length && !this.fridges(bp).length) {
      this.state.fridge = [];
      changed = true;
    }
    return this.syncTableGames(bp) || changed;
  }

  /**
   * Lifts that went (or stopped stopping somewhere): anyone in one gets out on the floor it was at, and anyone
   * waiting for one gives up.
   */
  private liftsChanged(bp: Blueprint, now: number): boolean {
    if (!this.state.lifts) return false;
    let changed = false;
    const there = new Set(liftsIn(bp, this.cat).map(({ o }) => o.id));
    for (const [id, car] of Object.entries(this.state.lifts)) {
      const stops = new Set(liftStops(bp, id, this.cat).map((s) => s.level));
      for (const a of Object.values(this.state.avatars)) {
        const r = a.use?.ride;
        if (r?.lift !== id) continue;
        if (r.on && !there.has(id)) {
          // out where the car was, at the nearest place to stand on that floor (or the ground floor)
          const L = Math.round(liftHeight(car, now) / STOREY);
          const here = a.path[a.path.length - 1]!;
          const cell: Cell = [Math.floor(here[0]), Math.floor(here[1])];
          let at = bp.levels[L] ? nearestWalkable(buildNav(bp, L, this.cat), cell) : null;
          let level = L;
          if (!at) [at, level] = [nearestWalkable(buildNav(bp, 0, this.cat), cell), 0];
          a.path = [middle([...(at ?? cell), level])];
          a.startedAt = now;
          a.use = null;
          changed = true;
        } else if (!r.on && (!there.has(id) || !stops.has(floorOf(a)))) {
          a.use = null;
          changed = true;
        }
      }
      if (!there.has(id)) {
        delete this.state.lifts[id];
        changed = true;
      }
    }
    return changed;
  }

  /** Pick up from a saved state on a new clock: everyone where they were, meals paused, eating finished. */
  static restore(saved: LifeState, now: number, cat: Catalog = defaultCatalog): Life {
    // a plate's clock is the real one: one left out while the house was empty goes in the fridge on the first look
    const state: LifeState = { avatars: {}, cooking: null, dishes: (saved.dishes ?? []).map((d) => ({ ...d, servedAt: d.servedAt ?? now })) };
    if (saved.fridge) state.fridge = saved.fridge.map((l) => ({ ...l }));
    if (saved.blackjack) state.blackjack = structuredClone(saved.blackjack);
    const party = restoredParty(saved.party);
    if (party) state.party = party;
    // lifts stopped where they were going, doors shut; anyone in one carries on to their floor
    if (saved.lifts) state.lifts = Object.fromEntries(Object.entries(saved.lifts).map(([id, l]) => [id, { level: l.move ? l.move.to : l.level, stops: [...l.stops] }]));
    for (const a of Object.values(saved.avatars ?? {})) {
      const car = a.use?.ride?.on ? state.lifts?.[a.use.ride.lift] : undefined;
      const last = a.path[a.path.length - 1]!;
      const end: Point = car ? (car.level ? [last[0], last[1], car.level * STOREY] : [last[0], last[1]]) : last;
      const use =
        a.use?.action === "eat"
          ? a.use.objectId
            ? { ...a.use, action: "sit" as const, dishId: undefined, until: undefined }
            : null
          : together(a.use) || brief(a.use) || dancingInPlace(a.use)
            ? null
            : a.use;
      // the rest of a trip planned on the old clock is dropped: they get to their floor and stand
      const ride = use?.ride && { ...use, ride: { lift: use.ride.lift, to: use.ride.to, ...(use.ride.on ? { on: true } : {}) } };
      state.avatars[a.memberId] = {
        ...a,
        path: [end],
        startedAt: now,
        use: ride || use,
        ...(a.needs ? { needs: { ...a.needs, at: now } } : {}),
        ...(a.auto ? { auto: { need: a.auto.need, since: now } } : {}),
      };
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
      avatars[a.memberId] = {
        ...a,
        path: [end],
        startedAt: 0,
        use: together(a.use) || brief(a.use) || dancingInPlace(a.use) ? null : settled || a.use?.action !== "eat" ? a.use : null,
        ...(a.needs ? { needs: { v: needsAt(a, now), at: 0, live: false } } : {}),
        ...(a.auto ? { auto: { need: a.auto.need, since: 0 } } : {}),
      };
    }
    const c = this.state.cooking;
    const recipe = c && this.cat.recipes.get(c.recipeId);
    return {
      avatars,
      cooking: c && recipe ? { ...c, done: cookingDone(c, recipe, now), rate: 0, updatedAt: 0 } : null,
      dishes: this.state.dishes.map((d) => ({ ...d })),
      ...(this.state.fridge ? { fridge: this.state.fridge.map((l) => ({ ...l })) } : {}),
      ...(this.state.blackjack ? { blackjack: structuredClone(this.state.blackjack) } : {}),
      ...(this.state.party ? { party: savedParty(this.state.party, now) } : {}),
      ...(this.state.lifts ? { lifts: Object.fromEntries(Object.entries(this.state.lifts).map(([id, l]) => [id, { level: l.move ? l.move.to : l.level, stops: [...l.stops] }])) } : {}),
    };
  }
}

/**
 * Everything that can change what someone's doing first writes down everyone's needs as
 * they stood, since from then on they go differently. One that's turned down, or finds nothing to do, puts them
 * back, so it leaves the state just as it was, like everything else it does.
 */
const CHANGES = ["walk", "use", "dance", "cards", "move", "stop", "social", "cook", "help", "eat", "takeOut", "store", "ride", "tick", "onBlueprint"] as const;
for (const name of CHANGES) {
  const change = Life.prototype[name] as (this: Life, ...args: unknown[]) => LifeReject | boolean | null;
  Object.defineProperty(Life.prototype, name, {
    value(this: Life, ...args: unknown[]) {
      const before = Object.values(this.state.avatars).map((a) => [a, a.needs] as const);
      // Walk's optional floor follows its clock. Every other method takes time last.
      const cameOrWent = this.settle(args[name === "walk" ? 3 : args.length - 1] as number);
      const r = change.apply(this, args);
      if (cameOrWent) return r === false ? true : r;
      if (r !== null && r !== true) for (const [a, needs] of before) a.needs = needs;
      return r;
    },
  });
}
