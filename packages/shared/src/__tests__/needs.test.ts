import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { Life } from "../life/engine";
import { DECAY, moodName, moodOf, needsAt, NEEDS, START_NEEDS, worstNeed, type NeedValues } from "../life/needs";
import { arrivalTime, emptyLife, EAT_MS } from "../life/state";
import { Op } from "../ops";
import { applyOp } from "../rules";

function place(bp: Blueprint, id: string, catalogId: string, x: number, z: number) {
  const r = applyOp(bp, Op.parse({ t: "object.place", level: 0, id, catalogId, x, z, rot: 0 }));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}

const MIN = 60_000;

function house() {
  let bp = place(emptyBlueprint(10, 10), "loo0000001", "toilet", 1, 1);
  bp = place(bp, "bed0000001", "bed_double", 5, 1);
  const life = new Life(emptyLife());
  life.ensureAvatar("amy", bp, 0);
  life.ensureAvatar("ben", bp, 0);
  const amy = () => life.state.avatars.amy!;
  return { bp, life, amy };
}

describe("needs", () => {
  it("start comfortable and run down slowly while you're in the house", () => {
    const { amy } = house();
    expect(needsAt(amy(), 0)).toEqual(START_NEEDS);
    const later = needsAt(amy(), 10 * MIN);
    for (const n of NEEDS) expect(later[n]).toBeCloseTo(START_NEEDS[n] - DECAY[n] * 10);
    // they bottom out rather than going below nothing
    for (const n of NEEDS) expect(needsAt(amy(), 1000 * MIN)[n]).toBe(0);
  });

  it("only run down for someone who's here", () => {
    const { bp, life, amy } = house();
    life.online = new Set(["ben"]);
    // Amy left at the start: the tick that notices says so, and her needs wait for her
    expect(life.tick(bp, 0)).toBe(true);
    expect(needsAt(amy(), 30 * MIN)).toEqual(START_NEEDS);
    expect(needsAt(life.state.avatars.ben!, 30 * MIN).hunger).toBeLessThan(START_NEEDS.hunger);
    life.online = new Set(["amy", "ben"]);
    expect(life.tick(bp, 30 * MIN)).toBe(true);
    expect(needsAt(amy(), 30 * MIN)).toEqual(START_NEEDS);
    expect(needsAt(amy(), 40 * MIN).hunger).toBeCloseTo(START_NEEDS.hunger - 10 * DECAY.hunger);
  });

  it("fill up with what you do, from when you get there", () => {
    const { bp, life, amy } = house();
    expect(life.use("amy", bp, "bed0000001", "sleep", 0)).toBeNull();
    const there = arrivalTime(amy());
    expect(there).toBeGreaterThan(0);
    // walking over tires you a little; then an hour's sleep and you're rested
    expect(needsAt(amy(), there).energy).toBeLessThan(START_NEEDS.energy);
    expect(needsAt(amy(), there + 60 * MIN).energy).toBe(100);
    expect(needsAt(amy(), there + 60 * MIN).hunger).toBeLessThan(START_NEEDS.hunger);
  });

  it("keep what was done when you change your mind", () => {
    const { bp, life, amy } = house();
    life.use("amy", bp, "bed0000001", "sleep", 0);
    const t = arrivalTime(amy()) + 2 * MIN;
    const rested = needsAt(amy(), t).energy;
    expect(life.walk("amy", bp, [8, 8], t)).toBeNull();
    // written down at the moment she got up, and only walking from there
    expect(amy().needs!.at).toBe(t);
    expect(amy().needs!.v.energy).toBeCloseTo(rested, 1);
    expect(needsAt(amy(), t + MIN).energy).toBeLessThan(rested);
  });

  it("empty your bladder on the toilet, and stop counting it once you're done", () => {
    const { bp, life, amy } = house();
    life.use("amy", bp, "loo0000001", "toilet", 0);
    const done = amy().use!.until!;
    expect(needsAt(amy(), done).bladder).toBe(100);
    // the tick that gets her up is late: the toilet still stopped counting at `done`
    const late = done + MIN;
    const before = needsAt(amy(), late);
    expect(before.bladder).toBeCloseTo(100 - DECAY.bladder);
    life.tick(bp, late);
    expect(needsAt(amy(), late).bladder).toBeCloseTo(before.bladder, 1);
  });

  it("fill you about halfway with a plate", () => {
    const v: NeedValues = { ...START_NEEDS, hunger: 20 };
    const { life, amy } = house();
    amy().needs = { v, at: 0, live: true };
    amy().use = { objectId: null, action: "eat", slot: 0, pose: null, dishId: "x", until: EAT_MS };
    const fed = needsAt(amy(), EAT_MS).hunger;
    expect(fed).toBeGreaterThan(60);
    expect(fed).toBeLessThan(75);
    expect(life).toBeTruthy();
  });

  it("are saved, and pick up again on a new clock", () => {
    const { life, amy } = house();
    const at = 20 * MIN;
    const v = needsAt(amy(), at);
    const saved = life.saved(at);
    expect(saved.avatars.amy!.needs!.v).toEqual(v);
    const back = Life.restore(JSON.parse(JSON.stringify(saved)), 5);
    // nothing ran down while the house was shut
    expect(needsAt(back.state.avatars.amy!, 5)).toEqual(v);
    // old saves without needs start fresh
    const old = Life.restore({ ...saved, avatars: { amy: { ...saved.avatars.amy!, needs: undefined } } }, 0);
    expect(needsAt(old.state.avatars.amy!, 0)).toEqual(START_NEEDS);
    old.settle(0);
    expect(old.state.avatars.amy!.needs).toMatchObject({ v: START_NEEDS, live: true });
  });

  it("add up to a mood, pulled down by whatever's worst", () => {
    const full = Object.fromEntries(NEEDS.map((n) => [n, 100])) as NeedValues;
    expect(moodOf(full)).toBe(100);
    expect(moodName(moodOf(full))).toBe("Very happy");
    expect(worstNeed(full)).toBeNull();
    const starving = { ...full, hunger: 5, bladder: 15 };
    expect(moodOf(starving)).toBeLessThan(50);
    expect(worstNeed(starving)).toBe("hunger");
    expect(moodName(moodOf(Object.fromEntries(NEEDS.map((n) => [n, 0])) as NeedValues))).toBe("Miserable");
  });
});
