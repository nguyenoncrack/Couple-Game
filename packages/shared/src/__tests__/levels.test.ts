import { describe, expect, it } from "vitest";
import { emptyBlueprint, MAX_LEVELS, STOREY, upgradeBlueprint, type Blueprint } from "../blueprint";
import { catalog } from "../catalog";
import { Life } from "../life/engine";
import { buildNav, levelOf, liftStops, walkable } from "../life/nav";
import { START_NEEDS } from "../life/needs";
import { arrivalTime, cellOf, emptyLife, floorOf, liftHeight, positionAt, type Lift } from "../life/state";
import { Op } from "../ops";
import { flightOf, stairHoles } from "../stairs";
import { applyOp } from "../rules";
import { inverseOp } from "../undo";

const apply = (bp: Blueprint, op: Op) => {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw new Error(r.reason);
  return r.blueprint;
};
const reason = (bp: Blueprint, op: Op) => {
  const r = applyOp(bp, Op.parse(op));
  return r.ok ? null : r.reason;
};

describe("floors", () => {
  it("adds floors on top, one at a time, up to the limit", () => {
    let bp = emptyBlueprint(8, 8);
    expect(reason(bp, { t: "level.add", level: 2 })).toBe("no-level");
    for (let i = 1; i < MAX_LEVELS; i++) bp = apply(bp, { t: "level.add", level: i });
    expect(bp.levels).toHaveLength(MAX_LEVELS);
    expect(reason(bp, { t: "level.add", level: MAX_LEVELS })).toBe("too-many-levels");
  });

  it("builds on the floor it's told, and upstairs only on floor that's been laid", () => {
    let bp = apply(emptyBlueprint(8, 8), { t: "level.add", level: 1 });
    bp = apply(bp, { t: "walls.add", level: 1, edges: ["h:1:2", "h:2:2"], style: "plaster_cream" });
    expect(Object.keys(bp.levels[0]!.walls)).toEqual([]);
    expect(Object.keys(bp.levels[1]!.walls)).toHaveLength(2);
    const chair = { t: "object.place", level: 1, id: "chair00001", catalogId: "dining_chair", x: 3, z: 3, rot: 0 } as const;
    expect(reason(bp, chair)).toBe("needs-floor");
    bp = apply(bp, { t: "floor.paint", level: 1, cells: ["3:3"], material: "oak" });
    bp = apply(bp, chair);
    expect(bp.levels[1]!.objects.chair00001).toBeDefined();
    // the floor can't go from under it
    expect(reason(bp, { t: "floor.paint", level: 1, cells: ["3:3"], material: null })).toBe("furniture-on-it");
    // but the ground floor is the lot: furniture goes anywhere
    expect(reason(bp, { ...chair, level: 0, id: "chair00002" })).toBeNull();
  });

  it("takes only a bare top floor away, and undoes either way", () => {
    let bp = apply(emptyBlueprint(8, 8), { t: "level.add", level: 1 });
    expect(reason(bp, { t: "level.remove", level: 0 })).toBe("no-level");
    const before = bp;
    bp = apply(bp, { t: "floor.paint", level: 1, cells: ["1:1"], material: "oak" });
    expect(reason(bp, { t: "level.remove", level: 1 })).toBe("level-not-empty");
    bp = before;
    const undo = inverseOp(bp, { t: "level.remove", level: 1 })!;
    bp = apply(bp, { t: "level.remove", level: 1 });
    expect(bp.levels).toHaveLength(1);
    expect(apply(bp, undo).levels).toHaveLength(2);
    expect(inverseOp(emptyBlueprint(8, 8), { t: "level.add", level: 1 })).toEqual({ t: "level.remove", level: 1 });
  });

  it("leaves one-floor houses and old saves as they were", () => {
    const old = { schema: 3, lot: { w: 8, d: 8 }, levels: [{ walls: {}, tiles: {}, objects: {} }] } as never;
    const bp = upgradeBlueprint(old);
    expect(bp.levels).toHaveLength(1);
    expect(apply(bp, { t: "level.add", level: 1 }).levels).toHaveLength(2);
  });
});

describe("stairs", () => {
  /** Two floors on an open lot, with floor laid upstairs everywhere but `bare`. */
  function twoFloors(bare: string[] = []) {
    let bp = apply(emptyBlueprint(10, 10), { t: "level.add", level: 1 });
    const cells: string[] = [];
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) if (!bare.includes(`${x}:${z}`)) cells.push(`${x}:${z}`);
    return apply(bp, { t: "floor.paint", level: 1, cells, material: "oak" });
  }
  const stairs = (x: number, z: number, rot: 0 | 1 | 2 | 3 = 0, id = "stairs0001") => ({ t: "object.place", level: 0, id, catalogId: "stairs_oak", x, z, rot }) as const;

  it("climbs the way it faces, with somewhere to step on and off", () => {
    const item = catalog.furniture.get("stairs_oak")!;
    expect(flightOf(item, { x: 4, z: 2, rot: 0 }).lanes).toEqual([{ cells: [[4, 2], [4, 3], [4, 4]], entry: [4, 1], exit: [4, 5] }]);
    expect(flightOf(item, { x: 4, z: 2, rot: 2 }).lanes[0]).toMatchObject({ entry: [4, 5], exit: [4, 1] });
    // turned a quarter, it lies along x and climbs towards -x
    expect(flightOf(item, { x: 2, z: 4, rot: 1 }).lanes[0]).toEqual({ cells: [[4, 4], [3, 4], [2, 4]], entry: [5, 4], exit: [1, 4] });
    expect(flightOf(catalog.furniture.get("stairs_wide")!, { x: 4, z: 2, rot: 0 }).lanes).toHaveLength(2);
  });

  it("needs a floor above with floor to step off onto, and cuts a hole in it", () => {
    expect(reason(emptyBlueprint(10, 10), stairs(4, 2))).toBe("needs-floor-above");
    expect(reason(twoFloors(["4:5"]), stairs(4, 2))).toBe("needs-landing");
    // a batch can lay the landing and put the stairs in together
    expect(reason(twoFloors(["4:5"]), { t: "batch", ops: [{ t: "floor.paint", level: 1, cells: ["4:5"], material: "oak" }, stairs(4, 2)] })).toBeNull();
    const bp = apply(twoFloors(), stairs(4, 2));
    expect([...stairHoles(bp, 1, catalog)].sort()).toEqual(["4:2", "4:3", "4:4"]);
  });

  it("won't be walled off or built over, top or bottom", () => {
    let bp = twoFloors();
    // a wall across the bottom step, or one upstairs across the top
    expect(reason(apply(bp, { t: "walls.add", level: 0, edges: ["h:4:2"], style: "plaster_cream" }), stairs(4, 2))).toBe("blocks-stairs");
    bp = apply(bp, stairs(4, 2));
    expect(reason(bp, { t: "walls.add", level: 1, edges: ["h:4:5"], style: "plaster_cream" })).toBe("blocks-stairs");
    expect(reason(bp, { t: "walls.add", level: 1, edges: ["h:4:3"], style: "plaster_cream" })).toBe("blocks-stairs");
    // walls beside the stairwell are fine
    expect(reason(bp, { t: "walls.add", level: 1, edges: ["v:4:3"], style: "plaster_cream" })).toBeNull();
    // nothing standing at the bottom, in the stairwell, or on the landing
    const chair = (level: number, x: number, z: number) => ({ t: "object.place", level, id: "chair00001", catalogId: "dining_chair", x, z, rot: 0 }) as const;
    expect(reason(bp, chair(0, 4, 1))).toBe("blocks-stairs");
    expect(reason(bp, chair(1, 4, 3))).toBe("blocks-stairs");
    expect(reason(bp, chair(1, 4, 5))).toBe("blocks-stairs");
    expect(reason(bp, chair(1, 5, 5))).toBeNull();
    // and the landing can't be taken up while they're there
    expect(reason(bp, { t: "floor.paint", level: 1, cells: ["4:5"], material: null })).toBe("blocks-stairs");
    // but taking the stairs out is always fine, and then so is all of that
    bp = apply(bp, { t: "object.remove", level: 0, id: "stairs0001" });
    expect(reason(bp, { t: "floor.paint", level: 1, cells: ["4:5"], material: null })).toBeNull();
  });

  it("can't leave the floor above while stairs reach it", () => {
    let bp = apply(emptyBlueprint(10, 10), { t: "level.add", level: 1 });
    bp = apply(bp, { t: "batch", ops: [{ t: "floor.paint", level: 1, cells: ["4:5"], material: "oak" }, stairs(4, 2)] });
    expect(reason(bp, { t: "level.remove", level: 1 })).toBe("level-not-empty");
  });
});

describe("walking between floors", () => {
  const T0 = 1_000_000;
  let n = 0;
  const ids = () => `id${String(++n).padStart(8, "0")}`;
  /** Two floors on an open lot, floored all over upstairs, with stairs from (4, 1) on the ground up to (4, 5). */
  function house() {
    let bp = apply(emptyBlueprint(10, 10), { t: "level.add", level: 1 });
    const cells: string[] = [];
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) cells.push(`${x}:${z}`);
    bp = apply(bp, { t: "floor.paint", level: 1, cells, material: "oak" });
    bp = apply(bp, { t: "object.place", level: 0, id: "stairs0001", catalogId: "stairs_oak", x: 4, z: 2, rot: 0 });
    const life = new Life(emptyLife(), catalog, ids);
    life.ensureAvatar("ana", bp, T0);
    return { bp, life, a: life.state.avatars.ana! };
  }
  const holes = ["4:2", "4:3", "4:4"];

  it("goes up the stairs a step at a time, and never across the stairwell", () => {
    const { bp, life, a } = house();
    expect(life.walk("ana", bp, [8, 3], T0, 1)).toBeNull();
    expect(floorOf(a)).toBe(1);
    const end = arrivalTime(a);
    expect(positionAt(a, end).y).toBeCloseTo(STOREY);
    // the height only ever goes up, and smoothly (no jumps between points)
    let last = 0;
    for (let t = T0; t <= end; t += 50) {
      const y = positionAt(a, t).y;
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      expect(y - last).toBeLessThan(0.2);
      last = y;
    }
    // upstairs, it never steps over the hole
    for (const q of a.path) if (levelOf(q) === 1 && Math.abs((q[2] ?? 0) - STOREY) < 1e-9) expect(holes).not.toContain(`${Math.floor(q[0])}:${Math.floor(q[1])}`);
    // and back down again, onto the ground floor
    expect(life.walk("ana", bp, [1, 1], end, 0)).toBeNull();
    expect(positionAt(a, arrivalTime(a)).y).toBe(0);
  });

  it("finishes the flight when stopped on the stairs", () => {
    const { bp, life, a } = house();
    life.walk("ana", bp, [4, 8], T0, 1);
    let t = T0;
    while (positionAt(a, t).y < STOREY / 2) t += 20;
    life.stop("ana", t);
    expect(floorOf(a)).toBe(1);
    expect(positionAt(a, arrivalTime(a)).y).toBeCloseTo(STOREY);
    // a new walk from there carries on up first, too
    let u = arrivalTime(a);
    life.walk("ana", bp, [1, 1], u, 0);
    while (positionAt(a, u).y > STOREY / 2) u += 20;
    expect(life.walk("ana", bp, [8, 8], u, 1)).toBeNull();
    expect(positionAt(a, arrivalTime(a)).y).toBeCloseTo(STOREY);
  });

  it("can't get upstairs without stairs, and finds things on any floor", () => {
    const { bp, life, a } = house();
    const flat = apply(bp, { t: "object.remove", level: 0, id: "stairs0001" });
    expect(life.walk("ana", flat, [8, 8], T0, 1)).toBe("unreachable");
    const withChair = apply(bp, { t: "object.place", level: 1, id: "chair00001", catalogId: "dining_chair", x: 7, z: 7, rot: 0 });
    expect(life.use("ana", withChair, "chair00001", "sit", T0)).toBeNull();
    expect(floorOf(a)).toBe(1);
    expect(life.use("ana", apply(withChair, { t: "object.remove", level: 0, id: "stairs0001" }), "chair00001", "sit", T0 + 1)).toBe("unreachable");
  });

  it("walks up the stairs in first person, from the foot of them", () => {
    const { bp, life, a } = house();
    life.walk("ana", bp, [4, 1], T0, 0);
    const t = arrivalTime(a);
    // heading off sideways is just a step
    expect(life.move("ana", bp, [5.2, 1.5], t)).toBeNull();
    expect(floorOf(a)).toBe(0);
    life.walk("ana", bp, [4, 1], t + 1, 0);
    // straight at them: all the way up
    expect(life.move("ana", bp, [4.5, 2.4], arrivalTime(a))).toBeNull();
    expect(floorOf(a)).toBe(1);
    expect(a.path[a.path.length - 1]).toEqual([4.5, 5.5, STOREY]);
  });

  it("steps aside when the floor under them goes, and stays put when stairs they need go", () => {
    const { bp, life, a } = house();
    life.walk("ana", bp, [8, 8], T0, 1);
    const t = arrivalTime(a);
    const holed = apply(bp, { t: "floor.paint", level: 1, cells: ["8:8"], material: null });
    life.onBlueprint(holed, t);
    expect(floorOf(a)).toBe(1);
    expect(a.path[a.path.length - 1]!.slice(0, 2)).not.toEqual([8.5, 8.5]);
    // walking down when the stairs are taken out: they don't go
    const u = arrivalTime(a);
    life.walk("ana", holed, [1, 1], u, 0);
    life.onBlueprint(apply(holed, { t: "object.remove", level: 0, id: "stairs0001" }), u + 100);
    expect(floorOf(a)).toBe(1);
  });

  it("lets free will go upstairs for what it needs", () => {
    const { bp, life, a } = house();
    const bed = apply(bp, { t: "object.place", level: 1, id: "bed0000001", catalogId: "bed_double", x: 6, z: 6, rot: 0 });
    life.enableFreeWill();
    a.needs = { v: { ...START_NEEDS, energy: 5 }, at: T0, live: true };
    life.tick(bed, T0);
    expect(a.use?.action).toBe("sleep");
    expect(floorOf(a)).toBe(1);
  });
});

describe("lifts", () => {
  const T0 = 1_000_000;
  let n = 0;
  const ids = () => `lf${String(++n).padStart(8, "0")}`;
  /** Two floors floored all over upstairs, with a lift on the ground at (2, 2) opening onto z = 4. */
  function house(members = ["ana"], seed?: Blueprint) {
    let bp = seed ?? apply(emptyBlueprint(10, 10), { t: "level.add", level: 1 });
    if (!seed) {
      const cells: string[] = [];
      for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) cells.push(`${x}:${z}`);
      bp = apply(bp, { t: "floor.paint", level: 1, cells, material: "oak" });
      bp = apply(bp, lift());
    }
    const life = new Life(emptyLife(), catalog, ids);
    for (const m of members) life.ensureAvatar(m, bp, T0);
    return { bp, life };
  }
  const lift = (level = 0, x = 2, z = 2) => ({ t: "object.place", level, id: "lift000001", catalogId: "lift_glass", x, z, rot: 0 }) as const;
  /** Let time pass, waking whenever the house says something's due (as the server does). */
  function run(life: Life, bp: Blueprint, from: number, ms: number, each?: (t: number) => void) {
    let t = from;
    while (t < from + ms) {
      t = Math.min(from + ms, Math.max(t + 50, life.nextEvent(t) ?? from + ms));
      life.tick(bp, t);
      each?.(t);
    }
    return t;
  }

  it("goes on the ground floor, reaching a floor with somewhere to step out, with its shaft kept clear", () => {
    let bp = apply(emptyBlueprint(10, 10), { t: "level.add", level: 1 });
    expect(reason(emptyBlueprint(10, 10), lift())).toBe("needs-floor-above");
    expect(reason(bp, lift())).toBe("lift-no-stop");
    bp = apply(bp, { t: "floor.paint", level: 1, cells: ["2:4", "5:5", "2:2"], material: "oak" });
    expect(reason(bp, lift(1))).toBe("lift-ground");
    // nothing in the shaft upstairs, or across the doors
    const chair = (level: number, x: number, z: number) => ({ t: "object.place", level, id: "chair00001", catalogId: "dining_chair", x, z, rot: 0 }) as const;
    expect(reason(apply(bp, chair(1, 2, 2)), lift())).toBe("blocks-lift");
    expect(reason(apply(bp, { t: "walls.add", level: 1, edges: ["h:2:4"], style: "plaster_cream" }), lift())).toBe("blocks-lift");
    bp = apply(bp, lift());
    expect(reason(bp, chair(0, 3, 4))).toBe("blocks-lift");
    expect(reason(bp, { t: "walls.add", level: 0, edges: ["h:3:4"], style: "plaster_cream" })).toBe("blocks-lift");
    // the only way out upstairs can't be taken up, and nobody walks into the shaft
    expect(reason(bp, { t: "floor.paint", level: 1, cells: ["2:4"], material: null })).toBe("lift-no-stop");
    expect(walkable(buildNav(bp, 1, catalog), 2, 2)).toBe(false);
    expect(liftStops(bp, "lift000001", catalog)).toEqual([
      { level: 0, at: [2, 4] },
      { level: 1, at: [2, 4] },
    ]);
  });

  it("calls the car, waits, gets on, rides up, and gets off", () => {
    const { bp, life } = house();
    const a = life.state.avatars.ana!;
    expect(life.ride("ana", bp, "lift000001", 1, T0)).toBeNull();
    expect(a.use).toMatchObject({ action: "ride", ride: { to: 1 } });
    // they get there, call it, and (with it waiting there) step straight on
    const seen: string[] = ["waiting"];
    let trip: Lift | undefined;
    run(life, bp, T0, 30_000, () => {
      const r = a.use?.ride;
      const state = !r ? "off" : r.on ? "on" : "waiting";
      if (seen[seen.length - 1] !== state) seen.push(state);
      const car = life.lift("lift000001")!;
      if (car.move) trip = structuredClone(car);
    });
    expect(seen).toEqual(["waiting", "on", "off"]);
    expect(floorOf(a)).toBe(1);
    expect(a.path[a.path.length - 1]).toEqual([2.5, 4.5, STOREY]);
    // the car goes up smoothly, a storey in all
    const { departs, arrives } = trip!.move!;
    let last = 0;
    for (let t = departs - 100; t <= arrives + 100; t += 50) {
      const h = liftHeight(trip!, t);
      expect(h).toBeGreaterThanOrEqual(last);
      expect(h - last).toBeLessThan(0.15);
      last = h;
    }
    expect(last).toBeCloseTo(STOREY);
  });

  it("takes two at once, and comes back down when called", () => {
    const { bp, life } = house(["ana", "ben"]);
    life.ride("ana", bp, "lift000001", 1, T0);
    life.ride("ben", bp, "lift000001", 1, T0);
    let together = false;
    let t = run(life, bp, T0, 30_000, () => {
      if (life.state.avatars.ana!.use?.ride?.on && life.state.avatars.ben!.use?.ride?.on) together = true;
    });
    expect(together).toBe(true);
    expect(floorOf(life.state.avatars.ana!)).toBe(1);
    expect(floorOf(life.state.avatars.ben!)).toBe(1);
    // out through a door each, not on top of each other
    expect(cellOf(life.state.avatars.ana!)).not.toEqual(cellOf(life.state.avatars.ben!));
    // and from upstairs, back down
    expect(life.ride("ana", bp, "lift000001", 0, t)).toBeNull();
    t = run(life, bp, t, 30_000);
    expect(floorOf(life.state.avatars.ana!)).toBe(0);
    expect(life.lift("lift000001")!.level).toBe(0);
  });

  it("takes the lift on the way when it's the only way up, then carries on", () => {
    const { bp, life } = house();
    const a = life.state.avatars.ana!;
    const withChair = apply(bp, { t: "object.place", level: 1, id: "chair00001", catalogId: "dining_chair", x: 7, z: 7, rot: 0 });
    expect(life.use("ana", withChair, "chair00001", "sit", T0)).toBeNull();
    expect(a.use?.action).toBe("ride");
    // the seat's kept for them while they ride
    run(life, withChair, T0, 40_000);
    expect(a.use).toMatchObject({ action: "sit", objectId: "chair00001" });
    expect(floorOf(a)).toBe(1);
    // in the lift, orders wait
    life.ride("ana", withChair, "lift000001", 0, T0 + 40_000);
    let t = T0 + 40_000;
    while (!a.use?.ride?.on) t = run(life, withChair, t, 200);
    expect(life.walk("ana", withChair, [8, 8], t, 0)).toBe("in-lift");
  });

  it("lets free will ride up to bed", () => {
    const { bp, life } = house();
    const bed = apply(bp, { t: "object.place", level: 1, id: "bed0000001", catalogId: "bed_double", x: 6, z: 6, rot: 0 });
    const a = life.state.avatars.ana!;
    life.enableFreeWill();
    a.needs = { v: { ...START_NEEDS, energy: 5 }, at: T0, live: true };
    run(life, bed, T0, 60_000);
    expect(a.use?.action).toBe("sleep");
    expect(floorOf(a)).toBe(1);
  });

  it("lets everyone out when the lift's taken away, and picks up a ride after a reload", () => {
    const { bp, life } = house();
    const a = life.state.avatars.ana!;
    life.ride("ana", bp, "lift000001", 1, T0);
    let t = T0;
    while (!life.lift("lift000001")?.move || t < life.lift("lift000001")!.move!.departs + 500) t = run(life, bp, t, 100);
    expect(a.use?.ride?.on).toBe(true);
    // saved mid-ride: picked up again, they get there
    const again = Life.restore(life.saved(t), T0 + 100_000, catalog);
    run(again, bp, T0 + 100_000, 20_000);
    expect(again.state.avatars.ana!.use).toBeNull();
    expect(floorOf(again.state.avatars.ana!)).toBe(1);
    // taken away mid-ride: out on a floor, standing somewhere
    const gone = apply(bp, { t: "object.remove", level: 0, id: "lift000001" });
    life.onBlueprint(gone, t + 100);
    expect(a.use).toBeNull();
    expect(walkable(buildNav(gone, floorOf(a), catalog), ...cellOf(a))).toBe(true);
    expect(life.state.lifts).toEqual({});
  });
});
