import type { Blueprint } from "../blueprint";
import type { Action, Catalog } from "../catalog";
import type { Life, LifeReject } from "./engine";
import { actionsOf } from "./interactions";
import { GAIN, LOW_NEED, needsAt, NEEDS, type Need, type NeedValues } from "./needs";
import { arrivalTime, positionAt, type Avatar, type LifeAction, type Together } from "./state";

/**
 * Free will, Sims style: a character left to themselves looks after their own needs. Whatever's pressing comes
 * first (a bed when they're worn out, the toilet when they're bursting); otherwise they pick something they could
 * do with, with a bit of chance so it isn't always the same, and now and then just stand about or wander.
 *
 * Only the server runs this (one room per house), so it happens once and everyone sees the same thing through the
 * usual life updates. It looks after any character whose player hasn't told them to do anything for a while,
 * whether that player is still here or has gone. Any order from the player takes over at once (see `Life.command`).
 */

/** What they'll do with their partner for company (a chat more often than not), or just for fun. */
const FOR_COMPANY: readonly Together[] = ["talk", "talk", "hug", "hug", "kiss", "slowdance", "backrub", "highfive"];
const FOR_FUN: readonly Together[] = ["dance", "tickle", "joke", "highfive"];

/** How long a player leaves their character alone (here or away) before it starts doing things by itself. */
export const AUTO_AFTER_MS = 60_000;
/** Below this a need comes before anything else. */
export const URGENT = LOW_NEED + 5;
/** Up to here a need is looked after; a character leaves what they're doing once it's this full. */
const FULL = 95;
/** The longest a character acting on their own keeps at something, however it's going. */
const MAX_MS: Partial<Record<LifeAction, number>> = {
  sleep: 8 * 60_000,
  cuddle: 5 * 60_000,
  lounge: 3 * 60_000,
  sit: 90_000,
  watch: 4 * 60_000,
  play: 4 * 60_000,
  swim: 3 * 60_000,
  pingpong: 3 * 60_000,
  bathe: 2 * 60_000,
};
/** How often a character at something checks whether to stop. */
const CHECK_MS = 6000;

/** What a character acting on their own is up to: the need it's for (none for a pause), and since when. */
export interface Auto {
  need: Need | null;
  since: number;
  /** A pause: they stand about (or wander) until this. */
  until?: number;
}

/** Does doing this fill up that need? */
export const serves = (action: LifeAction, need: Need) => (GAIN[action]?.[need] ?? 0) > 0;

export class FreeWill {
  /** When each player last told their character to do something. */
  private input = new Map<string, number>();
  /** When to look at each character again. */
  private due = new Map<string, number>();
  /** The need each character last saw to, so the next pick goes elsewhere for a change. */
  private last = new Map<string, Need | null>();

  constructor(
    private life: Life,
    private cat: Catalog,
    private random: () => number,
  ) {}

  /** The player did something: no new ideas of their own for a while. */
  noteInput(memberId: string, now: number) {
    this.input.set(memberId, now);
    this.due.delete(memberId);
  }

  /** Look at this character again at `at` (and not before). */
  later(memberId: string, at: number) {
    this.due.set(memberId, at);
  }

  /**
   * Is this character up to themselves right now? Once their player hasn't told them anything for a while, here
   * or not: someone who's just left gets to finish what they were doing first.
   */
  free(memberId: string, now: number): boolean {
    if (!this.life.state.avatars[memberId] || !this.life.present(memberId)) return false;
    return now - (this.input.get(memberId) ?? -Infinity) >= AUTO_AFTER_MS;
  }

  /** The next moment free will wants a look, or null. */
  nextAt(now: number): number | null {
    let next = Infinity;
    for (const id of Object.keys(this.life.state.avatars)) {
      if (!this.life.present(id)) continue;
      const due = this.due.get(id) ?? now;
      next = Math.min(next, Math.max(due, (this.input.get(id) ?? -Infinity) + AUTO_AFTER_MS));
    }
    return next === Infinity ? null : Math.max(next, now);
  }

  /** Let everyone who's due think about what to do. True if anyone did something. */
  think(bp: Blueprint, now: number): boolean {
    let changed = false;
    for (const a of Object.values(this.life.state.avatars)) {
      if ((this.due.get(a.memberId) ?? -Infinity) > now || !this.free(a.memberId, now)) continue;
      if (this.one(a, bp, now)) changed = true;
      // never look again straight away
      if ((this.due.get(a.memberId) ?? -Infinity) <= now) this.due.set(a.memberId, now + CHECK_MS);
    }
    return changed;
  }

  private one(a: Avatar, bp: Blueprint, now: number): boolean {
    const id = a.memberId;
    const arrive = arrivalTime(a);
    // on the way somewhere: see once they're there
    if (now < arrive) return this.wait(id, arrive + 1500);
    const u = a.use;
    // a plate, the toilet, a hug: over by itself
    if (u?.startsAt !== undefined && now < u.startsAt) return this.wait(id, u.startsAt + 500);
    if (u?.until !== undefined && now < u.until) return this.wait(id, u.until + 500);

    const v = needsAt(a, now);
    const urgent = mostUrgent(v);
    if (u) {
      // something the player chose before going quiet: it carries on until it's done its job, like anything else
      const adopted = !a.auto;
      const auto = (a.auto ??= { need: purpose(u), since: now });
      const helps = urgent ? serves(u.action, urgent) || Boolean(u.station && urgent === "hunger") : false;
      if (u.action === "sleep" && this.cuddleUp(a, bp, v, now)) return true;
      const full = auto.need !== null && v[auto.need] >= FULL;
      // sitting on at the table once the plate's finished, or at the stove once the meal's off
      const pointless = u.station ? !this.life.state.cooking : auto.need !== null && !serves(u.action, auto.need);
      // a meal on the go takes as long as it takes
      const tooLong = !u.station && now - auto.since > (MAX_MS[u.action] ?? 2 * 60_000);
      if (!full && !pointless && !tooLong && !(urgent && !helps)) return this.wait(id, now + CHECK_MS) || adopted;
      this.life.stop(id, now);
      delete a.auto;
    } else if (a.auto?.until !== undefined && now < a.auto.until && !urgent) {
      return this.wait(id, a.auto.until);
    }
    this.choose(a, bp, v, urgent, now);
    return true;
  }

  private wait(memberId: string, at: number) {
    this.due.set(memberId, at);
    return false;
  }

  /** Pick something to do (or a moment's rest) and set off. */
  private choose(a: Avatar, bp: Blueprint, v: NeedValues, urgent: Need | null, now: number) {
    const id = a.memberId;
    const order = urgent ? NEEDS.filter((n) => v[n] < URGENT).sort((x, y) => v[x] - v[y]) : this.picks(id, v);
    // everyone's fine: sometimes just take a breather
    if (!urgent && (order.length === 0 || this.random() < 0.25)) return this.pause(a, bp, now);
    for (const need of order) {
      for (const attempt of this.ways(a, bp, need, now)) {
        if (attempt() !== null) continue;
        a.auto = { need, since: now };
        this.last.set(id, need);
        const t = a.use?.until ?? arrivalTime(a);
        this.due.set(id, Math.max(t, now) + 1500);
        return;
      }
    }
    // nothing to be done right now (all taken, or out of reach): try again in a little while
    this.pause(a, bp, now, 15_000 + this.random() * 15_000);
  }

  /** Needs worth doing something about, a likelier pick the lower they are; the last one seen to less likely. */
  private picks(memberId: string, v: NeedValues): Need[] {
    const pool = NEEDS.map((n) => {
      const short = 100 - v[n];
      // fun and company are always nice, even when you're not short of them
      let w = v[n] >= FULL ? 0 : short * short + (n === "fun" || n === "social" ? 120 : 0);
      if (this.last.get(memberId) === n) w *= 0.35;
      return { n, w };
    }).filter((p) => p.w > 0);
    const out: Need[] = [];
    while (pool.length) {
      let r = this.random() * pool.reduce((s, p) => s + p.w, 0);
      const i = Math.max(0, pool.findIndex((p) => (r -= p.w) < 0));
      out.push(pool.splice(i, 1)[0]!.n);
    }
    return out;
  }

  /** Stand about, or wander a few steps, for a little while. */
  private pause(a: Avatar, bp: Blueprint, now: number, ms = 6000 + this.random() * 12_000) {
    let until = now + ms;
    if (this.random() < 0.5) {
      const p = positionAt(a, now);
      const to: [number, number] = [Math.floor(p.x + (this.random() - 0.5) * 10), Math.floor(p.z + (this.random() - 0.5) * 10)];
      const cell: [number, number] = [Math.min(bp.lot.w - 1, Math.max(0, to[0])), Math.min(bp.lot.d - 1, Math.max(0, to[1]))];
      if (this.life.walk(a.memberId, bp, cell, now) === null) until = arrivalTime(a) + ms / 2;
    }
    a.auto = { need: null, since: now, until };
    this.last.set(a.memberId, null);
    this.due.set(a.memberId, until);
  }

  /** In bed beside their partner, lonely: cuddle up. */
  private cuddleUp(a: Avatar, bp: Blueprint, v: NeedValues, now: number): boolean {
    const p = this.partner(a);
    if (!p || v.social > 70 || p.use?.action !== "sleep" || p.use.objectId !== a.use?.objectId || this.random() > 0.5) return false;
    if (this.life.social(a.memberId, bp, "cuddle", now) !== null) return false;
    a.auto = { need: "social", since: now };
    this.due.set(a.memberId, now + CHECK_MS);
    return true;
  }

  private partner(a: Avatar) {
    return Object.values(this.life.state.avatars).find((o) => o.memberId !== a.memberId && this.life.present(o.memberId));
  }

  /** Doing one of these with your partner, if they're free for it. */
  private withPartner(a: Avatar, bp: Blueprint, from: readonly Together[], now: number): (() => LifeReject | null)[] {
    const p = this.partner(a);
    // only someone who's also up to themselves: never pull a player's character away from what they asked for
    if (!p || !this.free(p.memberId, now) || (p.use && !p.auto) || p.use?.action === "sleep") return [];
    const action = from[Math.floor(this.random() * from.length)]!;
    return [() => this.life.social(a.memberId, bp, action, now)];
  }

  /** The ways to see to a need, best first: each tries one thing and returns why it couldn't, or null if it's on. */
  private ways(a: Avatar, bp: Blueprint, need: Need, now: number): (() => LifeReject | null)[] {
    const id = a.memberId;
    const life = this.life;
    const use = (action: Action) => this.near(a, bp, action, now).map((o) => () => life.use(id, bp, o, action, now));
    switch (need) {
      case "hunger": {
        const plates = life.state.dishes
          .filter((d) => d.portions > Object.values(life.state.avatars).filter((o) => o.use?.dishId === d.id).length)
          .map((d) => () => life.eat(id, bp, d.id, now));
        const help = life.state.cooking ? [() => life.help(id, bp, now)] : [];
        // leftovers before cooking something new, the oldest first
        const fridge = (life.state.fridge ?? []).map((l) => () => life.takeOut(id, bp, l.id, null, true, now));
        const cook = this.shuffle([...this.cat.recipes.keys()]).map((r) => () => life.cook(id, bp, r, null, now));
        return [...plates, ...help, ...fridge, ...cook];
      }
      case "energy":
        return [...use("sleep"), ...use("lounge"), ...use("sit")];
      case "hygiene":
        return [...use("bathe"), ...use("wash"), ...use("swim")];
      case "bladder":
        return use("toilet");
      case "fun":
        return this.shuffle([use("watch"), use("play"), use("swim"), use("pingpong"), use("lounge"), this.withPartner(a, bp, FOR_FUN, now)]).flat();
      case "social":
        return this.withPartner(a, bp, FOR_COMPANY, now);
    }
  }

  /** Objects offering an action, nearest first. */
  private near(a: Avatar, bp: Blueprint, action: Action, now: number): string[] {
    const p = positionAt(a, now);
    return Object.values(bp.levels[0]!.objects)
      .filter((o) => actionsOf(o, this.cat).includes(action))
      .map((o) => ({ id: o.id, d: Math.hypot(o.x - p.x, o.z - p.z) }))
      .sort((x, y) => x.d - y.d)
      .map((o) => o.id);
  }

  private shuffle<T>(xs: T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}

/** The need something does the most for (cooking is for a meal), if any. */
function purpose(u: { action: LifeAction; station?: string }): Need | null {
  if (u.station) return "hunger";
  let best: Need | null = null;
  for (const n of NEEDS) if ((GAIN[u.action]?.[n] ?? 0) > (best ? GAIN[u.action]![best]! : 0)) best = n;
  return best;
}

/** The lowest need that's pressing, if any. */
export function mostUrgent(v: NeedValues): Need | null {
  let worst: Need | null = null;
  for (const n of NEEDS) if (v[n] < URGENT && (!worst || v[n] < v[worst])) worst = n;
  return worst;
}
