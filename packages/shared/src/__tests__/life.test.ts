import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { catalog } from "../catalog";
import { edgesBetween } from "../grid";
import { slotsOf, toWorld } from "../life/interactions";
import { Life } from "../life/engine";
import { buildNav, findPath, walkable } from "../life/nav";
import { arrivalTime, cookingRate, emptyLife, positionAt } from "../life/state";
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
    const a = { path: [[0.5, 0.5], [2.5, 0.5]] as [number, number][], startedAt: 1000 };
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
    let served = false;
    for (; t < 120_000 && !served; t += 250) {
      life.tick(bp, t);
      served = life.state.dishes.length > 0;
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
