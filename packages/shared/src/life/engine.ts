import type { Blueprint, Level } from "../blueprint";
import { catalog as defaultCatalog, type Action, type Catalog, type Station } from "../catalog";
import type { Rot } from "../grid";
import { newId } from "../ids";
import { footprintOf } from "../rules";
import { canSee, screenOf, seatsFacing, slotsFor, slotsOf, stationSlots, tvFacing, type PlacedSlot } from "./interactions";
import { gamingSpots } from "./gaming";
import { dealBlackjack, finishBlackjack, playBlackjack, type BlackjackCommand } from "./blackjack";
import { FreeWill } from "./autonomy";
import { needsAt, START_NEEDS } from "./needs";
import { buildNav, canStep, findPath, nearestWalkable, roomAt, slide, walkable, type Cell, type Nav } from "./nav";
import {
  activityAt,
  arrivalTime,
  cellOf,
  cookingDone,
  cookingRate,
  EAT_MS,
  isTogether,
  MAX_DISHES,
  positionAt,
  type Avatar,
  type Dish,
  type LifeState,
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

const center = ([x, z]: Cell): [number, number] => [x + 0.5, z + 0.5];
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
    const console = u.consoleId ? this.level(bp).objects[u.consoleId] : undefined;
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

  private level(bp: Blueprint): Level {
    return bp.levels[0]!;
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

  /** Where a character can start a new walk from without jumping: the cell they're stepping into. */
  private origin(a: Avatar, now: number) {
    const p = positionAt(a, now);
    const target = p.next < a.path.length ? a.path[p.next]! : a.path[a.path.length - 1]!;
    return { at: [p.x, p.z] as [number, number], cell: [Math.floor(target[0]), Math.floor(target[1])] as Cell };
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

  /** Walk a character to the nearest of `goals`, to do `use` when they get there. */
  private walkTo(a: Avatar, nav: Nav, goals: Cell[], use: Use | null, now: number): LifeReject | null {
    const o = this.origin(a, now);
    const cells = findPath(nav, o.cell, goals);
    if (!cells) return "unreachable";
    this.letGo(a);
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
    return Object.values(this.state.avatars).some(
      (o) => o.memberId !== memberId && !this.givesWay(o, memberId) && o.use?.objectId === s.objectId && o.use.slot === s.slot,
    );
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
    const r = this.walkTo(
      a,
      nav,
      [best.cells[best.cells.length - 1]!],
      { objectId: s.objectId, action: s.action, slot: s.slot, station: s.station, pose: s.pose, ...extra },
      now,
    );
    if (!r && s.seconds) a.use!.until = arrivalTime(a) + s.seconds * 1000;
    return r;
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
    if (action === "watch") return this.watch(a, bp, o.id, now);
    if (action === "play") return this.play(a, bp, o.id, now);
    if (action === "pingpong" || action === "blackjack") {
      const nav = buildNav(bp, 0, this.cat);
      const slots = slotsOf(o, action, this.cat);
      if (!slots.length) return "nothing-to-do";
      const reachable = slots.filter((s) => roomAt(nav, s.pose.x, s.pose.z, BODY_R)).map((s) => ({ ...s, around: [] }));
      return reachable.length ? this.goUse(a, nav, reachable, now) : "unreachable";
    }
    return this.goUse(a, buildNav(bp, 0, this.cat), slotsOf(o, action, this.cat), now);
  }

  /** Card choices belong to an arrived table participant and the round currently visible to them. */
  cards(memberId: string, bp: Blueprint, objectId: string, roundId: string | null, command: BlackjackCommand, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const table = this.level(bp).objects[objectId];
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
      const table = this.level(bp).objects[tableId];
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
    const level = this.level(bp);
    const console = level.objects[objectId]!;
    const controllers = slotsOf(console, "play", this.cat).length;
    if (!controllers) return "nothing-to-do";
    const used = Object.values(this.state.avatars).filter(
      (other) => other.memberId !== a.memberId && !this.givesWay(other, a.memberId) && other.use?.consoleId === console.id,
    ).length;
    if (used >= controllers) return "taken";
    const nav = buildNav(bp, 0, this.cat);
    const spots = gamingSpots(level, console, nav, this.cat);
    if (!spots) return "no-tv";
    const extra: Partial<Use> = { action: "play", tv: spots.tv.id, consoleId: console.id };
    const seated = spots.seats.length ? this.goUse(a, nav, spots.seats, now, extra) : "nothing-to-do";
    if (!seated) return null;
    if (spots.floor.length) return this.goUse(a, nav, spots.floor, now, extra);
    return seated === "nothing-to-do" ? "unreachable" : seated;
  }

  /**
   * Watch TV: picked from the TV, you go to the closest free seat with a view of it, or sit on the floor in front
   * if there's none; picked from a seat, you sit there and watch the TV it faces.
   */
  private watch(a: Avatar, bp: Blueprint, objectId: string, now: number): LifeReject | null {
    const level = this.level(bp);
    const nav = buildNav(bp, 0, this.cat);
    const o = level.objects[objectId]!;
    const isTv = Boolean(screenOf(o, this.cat));
    const seats = isTv ? seatsFacing(level, o, this.cat) : slotsOf(o, "sit", this.cat).filter((s) => tvFacing(level, s, this.cat));
    const r: LifeReject | null = seats.length ? this.goUse(a, nav, seats, now, { action: "watch" }) : "no-tv";
    if (!r) {
      const seat = seats.find((s) => s.objectId === a.use!.objectId && s.slot === a.use!.slot)!;
      a.use!.tv = isTv ? o.id : tvFacing(level, seat, this.cat)!.id;
      return null;
    }
    if (isTv) {
      const floor = this.goUse(a, nav, slotsOf(o, "watch", this.cat), now, { tv: o.id });
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
    const nav = buildNav(bp, 0, this.cat);
    const p = positionAt(a, now);
    const seated = a.use?.pose && p.next >= a.path.length;
    // from a seat you get up where you sat down from
    const from: [number, number] = seated ? a.path[a.path.length - 1]! : [p.x, p.z];
    let [dx, dz] = [to[0] - from[0], to[1] - from[1]];
    const len = Math.hypot(dx, dz);
    if (len > MOVE_MAX) [dx, dz] = [(dx / len) * MOVE_MAX, (dz / len) * MOVE_MAX];
    const end = slide(nav, from, [from[0] + dx, from[1] + dz], BODY_R);
    const moved = Math.hypot(end[0] - from[0], end[1] - from[1]) > 0.01;
    if (!moved && !a.use && p.next >= a.path.length) return "unreachable";
    this.letGo(a);
    if (a.use?.pose) a.face = a.use.pose.face;
    a.use = null;
    a.path = moved ? [from, end] : [from];
    a.startedAt = now;
    // a little shuffle (stopping where you are) doesn't turn you round
    if (Math.hypot(end[0] - from[0], end[1] - from[1]) > 0.15) a.face = rotToward(end[0] - from[0], end[1] - from[1]);
    return null;
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
    const nav = buildNav(bp, 0, this.cat);
    // they stop where they are (the cell they're stepping into); you go beside them, with no wall in between
    const [px, pz] = this.origin(p, now).cell;
    const beside: Cell[] = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (walkable(nav, px + dx, pz + dz) && canStep(nav, px, pz, px + dx, pz + dz)) beside.push([px + dx, pz + dz]);
    if (!beside.length || !findPath(nav, this.origin(a, now).cell, beside)) return "unreachable";
    this.stop(p.memberId, now);
    this.walkTo(a, nav, beside, null, now);

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
    return Object.values(this.state.avatars).filter((a) => a.use?.station && now >= arrivalTime(a) && this.present(a.memberId));
  }

  // --- eating ---

  eat(memberId: string, bp: Blueprint, dishId: string, now: number): LifeReject | null {
    const a = this.state.avatars[memberId];
    const dish = this.state.dishes.find((d) => d.id === dishId);
    if (!a || !dish) return "no-dish";
    const eating = Object.values(this.state.avatars).filter((o) => o.memberId !== memberId && !this.givesWay(o, memberId) && o.use?.dishId === dishId).length;
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
    const dish: Dish = {
      id: this.makeId(),
      recipeId,
      x: spot.x + (already % 2 ? 0.45 : -0.45) * Math.ceil(already / 2),
      z: spot.z,
      surfaceId: spot.id,
      portions: this.cat.recipes.get(recipeId)?.serves ?? 1,
    };
    this.state.dishes.push(dish);
    while (this.state.dishes.length > MAX_DISHES) {
      const i = this.state.dishes.findIndex((d) => !Object.values(this.state.avatars).some((a) => a.use?.dishId === d.id));
      this.state.dishes.splice(i < 0 ? 0 : i, 1);
    }
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
    let changed = this.syncTableGames(bp);
    for (const a of Object.values(this.state.avatars)) {
      const u = a.use;
      if ((together(u) || brief(u)) && u!.until !== undefined && now >= u!.until) {
        if (u!.pose) a.face = u!.pose.face;
        a.use = null;
        changed = true;
        // after the toilet, wash your hands if there's a sink you can get to
        if (u!.action === "toilet") this.goUse(a, buildNav(bp, 0, this.cat), slotsFor(this.level(bp), "wash", this.cat), now);
        continue;
      }
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
    const level = this.level(bp);
    const nav = buildNav(bp, 0, this.cat);
    let changed = false;
    for (const a of Object.values(this.state.avatars)) {
      const u = a.use;
      if (u?.objectId) {
        const o = level.objects[u.objectId];
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
        for (const a of Object.values(this.state.avatars))
          if (a.use?.dishId === d.id) a.use = a.use.objectId ? { ...a.use, action: "sit", dishId: undefined, until: undefined } : null;
      } else kept.push(d);
    }
    this.state.dishes = kept;
    return this.syncTableGames(bp) || changed;
  }

  /** Pick up from a saved state on a new clock: everyone where they were, meals paused, eating finished. */
  static restore(saved: LifeState, now: number, cat: Catalog = defaultCatalog): Life {
    const state: LifeState = { avatars: {}, cooking: null, dishes: saved.dishes ?? [] };
    if (saved.blackjack) state.blackjack = structuredClone(saved.blackjack);
    for (const a of Object.values(saved.avatars ?? {})) {
      const end = a.path[a.path.length - 1]!;
      const use =
        a.use?.action === "eat"
          ? a.use.objectId
            ? { ...a.use, action: "sit" as const, dishId: undefined, until: undefined }
            : null
          : together(a.use) || brief(a.use)
            ? null
            : a.use;
      state.avatars[a.memberId] = {
        ...a,
        path: [end],
        startedAt: now,
        use,
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
        use: together(a.use) || brief(a.use) ? null : settled || a.use?.action !== "eat" ? a.use : null,
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
      ...(this.state.blackjack ? { blackjack: structuredClone(this.state.blackjack) } : {}),
    };
  }
}

/**
 * Everything that can change what someone's doing (each takes the time last) first writes down everyone's needs as
 * they stood, since from then on they go differently. One that's turned down, or finds nothing to do, puts them
 * back, so it leaves the state just as it was, like everything else it does.
 */
const CHANGES = ["walk", "use", "cards", "move", "stop", "social", "cook", "help", "eat", "tick", "onBlueprint"] as const;
for (const name of CHANGES) {
  const change = Life.prototype[name] as (this: Life, ...args: unknown[]) => LifeReject | boolean | null;
  Object.defineProperty(Life.prototype, name, {
    value(this: Life, ...args: unknown[]) {
      const before = Object.values(this.state.avatars).map((a) => [a, a.needs] as const);
      const cameOrWent = this.settle(args[args.length - 1] as number);
      const r = change.apply(this, args);
      if (cameOrWent) return r === false ? true : r;
      if (r !== null && r !== true) for (const [a, needs] of before) a.needs = needs;
      return r;
    },
  });
}
