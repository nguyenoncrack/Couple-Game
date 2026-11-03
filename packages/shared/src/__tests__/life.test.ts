import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { catalog } from "../catalog";
import { edgesBetween } from "../grid";
import { slotsOf, toWorld } from "../life/interactions";
import { Life } from "../life/engine";
import { buildNav, findPath, walkable } from "../life/nav";
import { activityAt, arrivalTime, cookingRate, emptyLife, positionAt, type Avatar } from "../life/state";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { starterHouseOp } from "../starter";

function apply(bp: Blueprint, op: Op): Blueprint {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}

/** A wall from x 0 to 6 along z = 3, splitting the lot. */
const split = () => apply(emptyBlueprint(6, 6), { t: "walls.add", level: 0, edges: edgesBetween(0, 3, 6, 3), style: "plaster_cream" });

let n = 0;
const ids = () => `id${String(++n).padStart(8, "0")}`;
const starter = () => apply(emptyBlueprint(24, 20), starterHouseOp(0, ids));

describe("walking", () => {
  it("can't go through walls or windows, only doors", () => {
    let bp = split();
    expect(findPath(buildNav(bp), [1, 1], [[1, 5]])).toBeNull();
    bp = apply(bp, { t: "opening.place", level: 0, id: "win0000001", catalogId: "window_small", dir: "h", x: 2, z: 3, flip: false });
    expect(findPath(buildNav(bp), [1, 1], [[1, 5]])).toBeNull();
    bp = apply(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 4, z: 3, flip: false });
    const path = findPath(buildNav(bp), [1, 1], [[1, 5]])!;
    expect(path).toContainEqual([4, 2]);
    expect(path).toContainEqual([4, 3]);
  });

  it("walks round furniture, and never cuts a corner", () => {
    let bp = emptyBlueprint(5, 5);
    bp = apply(bp, { t: "object.place", level: 0, id: "fridge0001", catalogId: "fridge", x: 2, z: 2, rot: 0 });
    const nav = buildNav(bp);
    expect(walkable(nav, 2, 2)).toBe(false);
    const path = findPath(nav, [1, 2], [[3, 2]])!;
    expect(path).not.toContainEqual([2, 2]);
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1]!;
      const [x1, z1] = path[i]!;
      // a diagonal step past the fridge would clip its corner
      if (x0 !== x1 && z0 !== z1) expect(walkable(nav, x1, z0) && walkable(nav, x0, z1)).toBe(true);
    }
  });

  it("reaches every seat, bed and station in the starter house from the street", () => {
    const bp = starter();
    const nav = buildNav(bp);
    for (const o of Object.values(bp.levels[0]!.objects)) {
      for (const s of slotsOf(o)) {
        expect(findPath(nav, [12, 19], s.stand) ?? findPath(nav, [12, 19], s.around), `${o.catalogId} slot ${s.slot}`).not.toBeNull();
      }
    }
  });

  it("knows where a walker is part way along", () => {
    const a = {
      path: [
        [0.5, 0.5],
        [2.5, 0.5],
      ] as [number, number][],
      startedAt: 1000,
    };
    expect(arrivalTime(a)).toBeCloseTo(1000 + (2 / 2.2) * 1000);
    expect(positionAt(a, 1000 + 1000 / 2.2)).toMatchObject({ x: 1.5, z: 0.5, next: 1 });
    expect(positionAt(a, 99_999)).toMatchObject({ x: 2.5, heading: null });
  });
});

describe("furniture slots", () => {
  it("turn with the furniture", () => {
    const chair = catalog.furniture.get("dining_chair")!;
    // facing +x (rot 3): the item's own +z side is the lot's +x side
    const [x, z] = toWorld(chair, { x: 4, z: 4, rot: 3 }, 0.5, 1.5);
    expect(x).toBeCloseTo(5.5);
    expect(z).toBeCloseTo(4.5);
    const s = slotsOf({ id: "c", catalogId: "dining_chair", x: 4, z: 4, rot: 3 }, "sit")[0]!;
    expect(s.pose).toMatchObject({ x: 4.5, z: 4.5, face: 3 });
    expect(s.stand[0]).toEqual([5, 4]);
  });
});

describe("cooking", () => {
  const pancakes = catalog.recipes.get("pancakes")!;

  it("only goes with someone at the right station, and faster with help", () => {
    expect(cookingRate(pancakes, 0, [])).toBe(0);
    expect(cookingRate(pancakes, 0, ["stove"])).toBe(0);
    expect(cookingRate(pancakes, 0, ["counter"])).toBe(1);
    expect(cookingRate(pancakes, 0, ["counter", "stove"])).toBe(1.5);
  });

  it("makes a meal start to finish and puts it on the table", () => {
    const bp = starter();
    const life = new Life(emptyLife());
    let t = 0;
    life.ensureAvatar("amy", bp, t);
    life.ensureAvatar("ben", bp, t);
    expect(life.state.avatars.ben!.path[0]).not.toEqual(life.state.avatars.amy!.path[0]);
    expect(life.cook("amy", bp, "pancakes", null, t)).toBeNull();
    expect(life.cook("ben", bp, "pasta", null, t)).toBe("already-cooking");
    expect(life.help("ben", bp, t)).toBeNull();
    // the two of them take a counter each
    expect(life.state.avatars.amy!.use!.objectId).not.toBe(life.state.avatars.ben!.use!.objectId);
    // jump from one event to the next, as the server does
    let served = false;
    for (let steps = 0; steps < 50 && !served; steps++) {
      life.tick(bp, t);
      served = life.state.dishes.length > 0;
      const next = life.nextEvent(t);
      if (next === null) break;
      t = Math.max(next, t + 1);
    }
    expect(served).toBe(true);
    expect(life.state.cooking).toBeNull();
    const dish = life.state.dishes[0]!;
    expect(dish.portions).toBe(2);
    const table = Object.values(bp.levels[0]!.objects).find((o) => o.catalogId === "dining_table")!;
    expect(dish.surfaceId).toBe(table.id);

    // both sit down to eat it, and it's gone after
    expect(life.eat("amy", bp, dish.id, t)).toBeNull();
    expect(life.eat("ben", bp, dish.id, t)).toBeNull();
    expect(life.state.avatars.amy!.use!.objectId).not.toBe(life.state.avatars.ben!.use!.objectId);
    for (const end = t + 60_000; t < end; t += 250) life.tick(bp, t);
    expect(life.state.dishes).toEqual([]);
    expect(life.state.avatars.amy!.use!.action).toBe("sit");
  });

  it("needs a kitchen", () => {
    const bp = emptyBlueprint(6, 6);
    const life = new Life(emptyLife());
    life.ensureAvatar("amy", bp, 0);
    expect(life.cook("amy", bp, "pancakes", null, 0)).toBe("no-kitchen");
  });
});

describe("the house changing", () => {
  it("stands up whoever was sitting on furniture that's taken away", () => {
    let bp = emptyBlueprint(6, 6);
    bp = apply(bp, { t: "object.place", level: 0, id: "chair00001", catalogId: "dining_chair", x: 2, z: 2, rot: 0 });
    const life = new Life(emptyLife());
    life.ensureAvatar("amy", bp, 0);
    expect(life.use("amy", bp, "chair00001", "sit", 0)).toBeNull();
    expect(life.use("amy", bp, "chair00001", "sleep", 0)).toBe("nothing-to-do");
    life.ensureAvatar("ben", bp, 0);
    expect(life.use("ben", bp, "chair00001", "sit", 0)).toBe("taken");
    bp = apply(bp, { t: "object.remove", level: 0, id: "chair00001" });
    expect(life.onBlueprint(bp, 60_000)).toBe(true);
    expect(life.state.avatars.amy!.use).toBeNull();
  });

  it("steps aside when furniture lands on someone", () => {
    let bp = emptyBlueprint(6, 6);
    const life = new Life(emptyLife());
    life.ensureAvatar("amy", bp, 0);
    life.walk("amy", bp, [2, 2], 0);
    bp = apply(bp, { t: "object.place", level: 0, id: "fridge0001", catalogId: "fridge", x: 2, z: 2, rot: 0 });
    expect(life.onBlueprint(bp, 60_000)).toBe(true);
    const end = life.state.avatars.amy!.path.at(-1)!;
    expect([Math.floor(end[0]), Math.floor(end[1])]).not.toEqual([2, 2]);
  });
});

describe("together", () => {
  /** Amy at (1,1) and Ben at (4,1) on an open lot, both settled. */
  function pair(bp: Blueprint) {
    const life = new Life(emptyLife());
    life.ensureAvatar("amy", bp, 0);
    life.ensureAvatar("ben", bp, 0);
    life.walk("amy", bp, [1, 1], 0);
    life.walk("ben", bp, [4, 1], 0);
    return { life, amy: () => life.state.avatars.amy!, ben: () => life.state.avatars.ben! };
  }
  const cell = (a: Avatar) => a.path.at(-1)!.map(Math.floor);

  it("walks over for a hug, and you meet face to face once you're both there", () => {
    const bp = emptyBlueprint(6, 6);
    const { life, amy, ben } = pair(bp);
    const t = 60_000;
    expect(life.social("amy", bp, "hug", t)).toBeNull();
    expect(cell(amy())).toEqual([3, 1]);
    expect(amy().use).toMatchObject({ action: "hug", with: "ben" });
    expect(ben().use).toMatchObject({ action: "hug", with: "amy" });
    // facing each other across the cell edge, close together
    expect(amy().use!.pose!.face).toBe(3);
    expect(ben().use!.pose!.face).toBe(1);
    expect(ben().use!.pose!.x - amy().use!.pose!.x).toBeCloseTo(0.46);
    // Ben waits while Amy walks over, then they hug, then it's over
    const start = ben().use!.startsAt!;
    expect(start).toBe(arrivalTime(amy()));
    expect(activityAt(ben(), start - 1)).toBe("idle");
    expect(activityAt(ben(), start + 1)).toBe("hug");
    expect(life.nextEvent(start)).toBe(amy().use!.until);
    expect(life.tick(bp, amy().use!.until!)).toBe(true);
    expect(amy().use).toBeNull();
    expect(ben().use).toBeNull();
    expect(ben().face).toBe(1);
  });

  it("ends for both when either one moves off", () => {
    const bp = emptyBlueprint(6, 6);
    const { life, amy, ben } = pair(bp);
    life.social("amy", bp, "kiss", 60_000);
    expect(ben().use?.action).toBe("kiss");
    life.walk("ben", bp, [5, 5], 61_000);
    expect(amy().use).toBeNull();
  });

  it("gets a sitter up, but not someone busy, away, or behind a wall", () => {
    let bp = apply(emptyBlueprint(6, 6), { t: "object.place", level: 0, id: "chair00001", catalogId: "dining_chair", x: 4, z: 2, rot: 0 });
    const { life, ben } = pair(bp);
    life.use("ben", bp, "chair00001", "sit", 0);
    expect(life.social("amy", bp, "hug", 60_000)).toBeNull();
    expect(ben().use?.action).toBe("hug");

    life.online = new Set(["amy"]);
    expect(life.social("amy", bp, "kiss", 70_000)).toBe("partner-away");
    life.online = null;

    bp = apply(bp, { t: "object.place", level: 0, id: "bed0000001", catalogId: "bed_double", x: 0, z: 3, rot: 0 });
    life.use("ben", bp, "bed0000001", "sleep", 80_000);
    expect(life.social("amy", bp, "hug", 200_000)).toBe("partner-busy");

    // Ben goes through a door to the far side, then the door is walled up
    let walled = apply(split(), { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 4, z: 3, flip: false });
    const two = new Life(emptyLife());
    two.ensureAvatar("amy", walled, 0);
    two.ensureAvatar("ben", walled, 0);
    expect(two.walk("ben", walled, [4, 1], 0)).toBeNull();
    walled = apply(walled, { t: "opening.remove", level: 0, id: "door000001" });
    expect(two.social("amy", walled, "hug", 60_000)).toBe("unreachable");
    // nothing changed for Ben
    expect(two.state.avatars.ben!.use).toBeNull();
    expect(cell(two.state.avatars.ben!)).toEqual([4, 1]);
  });

  it("cuddles only when you're both in the same bed, and getting up ends it for both", () => {
    const bp = apply(emptyBlueprint(8, 8), { t: "object.place", level: 0, id: "bed0000001", catalogId: "bed_double", x: 3, z: 3, rot: 0 });
    const { life, amy, ben } = pair(bp);
    life.use("amy", bp, "bed0000001", "sleep", 0);
    expect(life.social("amy", bp, "cuddle", 60_000)).toBe("not-in-bed");
    life.use("ben", bp, "bed0000001", "sleep", 60_000);
    expect(life.social("amy", bp, "cuddle", 120_000)).toBeNull();
    expect(amy().use).toMatchObject({ action: "cuddle", with: "ben", objectId: "bed0000001" });
    expect(ben().use).toMatchObject({ action: "cuddle", with: "amy" });
    expect(life.social("ben", bp, "uncuddle", 130_000)).toBeNull();
    expect(amy().use?.action).toBe("sleep");
    life.social("amy", bp, "cuddle", 140_000);
    life.stop("ben", 150_000);
    expect(ben().use).toBeNull();
    expect(amy().use).toMatchObject({ action: "sleep", with: undefined });
    // a cuddle is saved as it is; a hug isn't
    life.use("ben", bp, "bed0000001", "sleep", 150_000);
    life.social("amy", bp, "cuddle", 200_000);
    expect(Life.restore(life.saved(200_000), 0).state.avatars.amy!.use?.action).toBe("cuddle");
  });
});

describe("around the house", () => {
  const place = (bp: Blueprint, id: string, catalogId: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) =>
    apply(bp, { t: "object.place", level: 0, id, catalogId, x, z, rot });
  /** Amy and Ben standing on an open lot. */
  function two(bp: Blueprint) {
    const life = new Life(emptyLife());
    life.ensureAvatar("amy", bp, 0);
    life.ensureAvatar("ben", bp, 0);
    return { life, amy: () => life.state.avatars.amy!, ben: () => life.state.avatars.ben! };
  }

  it("watches TV from a seat facing it, picked from either one, and just sits once the TV goes", () => {
    // the TV faces +z; the sofa across the room faces back at it, the chair beside it faces away
    let bp = place(emptyBlueprint(8, 8), "tv00000001", "tv_stand", 3, 0);
    bp = place(bp, "sofa000001", "sofa_cozy", 3, 4, 2);
    bp = place(bp, "chair00001", "dining_chair", 6, 1, 0);
    const { life, amy, ben } = two(bp);
    expect(life.use("amy", bp, "tv00000001", "watch", 0)).toBeNull();
    expect(amy().use).toMatchObject({ objectId: "sofa000001", action: "watch", tv: "tv00000001" });
    expect(life.use("ben", bp, "sofa000001", "watch", 0)).toBeNull();
    expect(ben().use).toMatchObject({ objectId: "sofa000001", action: "watch", tv: "tv00000001" });
    expect(ben().use!.slot).not.toBe(amy().use!.slot);
    expect(life.use("ben", bp, "chair00001", "watch", 0)).toBe("no-tv");

    bp = apply(bp, { t: "object.remove", level: 0, id: "tv00000001" });
    expect(life.onBlueprint(bp, 60_000)).toBe(true);
    expect(amy().use).toMatchObject({ objectId: "sofa000001", action: "sit", tv: undefined });
  });

  it("sits on the floor in front of the TV when there's no seat to watch from", () => {
    const bp = place(emptyBlueprint(8, 8), "tv00000001", "tv_stand", 3, 0);
    const { life, amy } = two(bp);
    expect(life.use("amy", bp, "tv00000001", "watch", 0)).toBeNull();
    expect(amy().use).toMatchObject({ objectId: "tv00000001", action: "watch", tv: "tv00000001" });
    expect(amy().use!.pose!.face).toBe(2);
  });

  it("washes your hands after the toilet, and each is over by itself", () => {
    let bp = place(emptyBlueprint(8, 8), "loo0000001", "toilet", 1, 1);
    bp = place(bp, "sink000001", "bath_sink", 3, 1);
    const { life, amy } = two(bp);
    expect(life.use("amy", bp, "loo0000001", "toilet", 0)).toBeNull();
    const done = amy().use!.until!;
    expect(done).toBe(arrivalTime(amy()) + 10_000);
    expect(life.nextEvent(arrivalTime(amy()))).toBe(done);
    expect(life.tick(bp, done)).toBe(true);
    expect(amy().use).toMatchObject({ objectId: "sink000001", action: "wash" });
    const washed = amy().use!.until!;
    expect(washed).toBe(arrivalTime(amy()) + 6_000);
    expect(life.tick(bp, washed)).toBe(true);
    expect(amy().use).toBeNull();
    expect(amy().face).toBe(2);

    // with no sink about you just get up; and a quick thing isn't saved part way
    const alone = place(emptyBlueprint(8, 8), "loo0000001", "toilet", 1, 1);
    const one = two(alone);
    one.life.use("amy", alone, "loo0000001", "toilet", 0);
    expect(one.life.saved(1_000).avatars.amy!.use).toBeNull();
    one.life.tick(alone, one.amy().use!.until!);
    expect(one.amy().use).toBeNull();
  });

  it("shares the bath, and swims laps side by side", () => {
    let bp = place(emptyBlueprint(12, 10), "tub0000001", "bathtub", 1, 1);
    bp = place(bp, "pool000001", "pool_rect", 3, 5);
    const { life, amy, ben } = two(bp);
    life.use("amy", bp, "tub0000001", "bathe", 0);
    life.use("ben", bp, "tub0000001", "bathe", 0);
    expect(amy().use!.pose!.face).not.toBe(ben().use!.pose!.face);
    // a bath lasts until you get out, saved and all
    expect(Life.restore(life.saved(60_000), 0).state.avatars.amy!.use?.action).toBe("bathe");

    expect(life.use("amy", bp, "pool000001", "swim", 60_000)).toBeNull();
    expect(life.use("ben", bp, "pool000001", "swim", 60_000)).toBeNull();
    for (const a of [amy(), ben()]) {
      expect(a.use!.action).toBe("swim");
      expect(a.use!.pose!.x).toBeGreaterThan(3);
      expect(a.use!.pose!.x).toBeLessThan(9);
      expect(a.use!.pose!.z).toBeGreaterThan(5);
      expect(a.use!.pose!.z).toBeLessThan(8);
    }
    expect(amy().use!.pose!.z).not.toBe(ben().use!.pose!.z);
  });
});

describe("walking freely", () => {
  /** Amy standing still at a spot on the lot. */
  function at(bp: Blueprint, x: number, z: number) {
    const life = new Life(emptyLife());
    life.ensureAvatar("amy", bp, 0);
    life.state.avatars.amy!.path = [[x, z]];
    return { life, amy: () => life.state.avatars.amy!, end: () => life.state.avatars.amy!.path.at(-1)! };
  }

  it("goes straight to a spot close by, and only so far in one step", () => {
    const bp = emptyBlueprint(8, 8);
    const { life, amy, end } = at(bp, 2.5, 2.5);
    expect(life.move("amy", bp, [3.3, 2.5], 1000)).toBeNull();
    expect(end()[0]).toBeCloseTo(3.3);
    expect(amy().path).toHaveLength(2);
    expect(amy().face).toBe(3);
    life.move("amy", bp, [7.5, 2.5], 60_000);
    expect(end()[0]).toBeCloseTo(3.3 + 1.2);
  });

  it("stops short of a wall and slides along it, but walks through a door", () => {
    let bp = split();
    const { life, end } = at(bp, 1.5, 2.5);
    life.move("amy", bp, [1.5, 3.5], 0);
    expect(end()[1]).toBeLessThan(3 - 0.2);
    expect(end()[1]).toBeGreaterThan(2.6);
    // heading into the wall at an angle, you carry on along it
    life.move("amy", bp, [2.3, 3.3], 60_000);
    expect(end()[0]).toBeCloseTo(2.3);
    expect(end()[1]).toBeLessThan(3);

    bp = apply(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 2, z: 3, flip: false });
    const through = at(bp, 2.5, 2.5);
    through.life.move("amy", bp, [2.5, 3.5], 0);
    expect(through.end()[1]).toBeCloseTo(3.5);
  });

  it("doesn't walk into furniture, and gets up from a seat to walk off", () => {
    let bp = place(emptyBlueprint(8, 8), "fridge0001", "fridge", 3, 2);
    const { life, amy, end } = at(bp, 2.5, 2.5);
    // up to the fridge, then no further
    expect(life.move("amy", bp, [3.5, 2.5], 0)).toBeNull();
    expect(end()[0]).toBeLessThan(3 - 0.2);
    expect(life.move("amy", bp, [3.5, 2.5], 60_000)).toBe("unreachable");

    bp = place(bp, "chair00001", "dining_chair", 5, 5);
    life.use("amy", bp, "chair00001", "sit", 60_000);
    expect(life.move("amy", bp, [end()[0], end()[1] + 1], 120_000)).toBeNull();
    expect(amy().use).toBeNull();
  });
});

function place(bp: Blueprint, id: string, catalogId: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) {
  return apply(bp, { t: "object.place", level: 0, id, catalogId, x, z, rot });
}
