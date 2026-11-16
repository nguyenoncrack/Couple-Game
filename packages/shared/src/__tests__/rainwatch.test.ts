import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { edgesBetween } from "../grid";
import { Life } from "../life/engine";
import { needsAt } from "../life/needs";
import { windowBehind, windowSeats } from "../life/rainwatch";
import { arrivalTime, emptyLife, type Avatar } from "../life/state";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { emptyWorld, SPELL_MS, spellRain } from "../world";

function apply(bp: Blueprint, op: Op): Blueprint {
  const r = applyOp(bp, Op.parse(op), undefined, { accepted: true });
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.blueprint;
}

/** A room (x 3..9, z 3..9) whose north wall has a window above where the bench sits at (5, 3), rotated as asked. */
function room(rot: 0 | 1 | 2 | 3 = 0, windowed = true): Blueprint {
  let bp = emptyBlueprint(14, 14);
  for (const [a, b, c, d] of [
    [3, 3, 9, 3],
    [9, 3, 9, 9],
    [9, 9, 3, 9],
    [3, 9, 3, 3],
  ] as const)
    bp = apply(bp, { t: "walls.add", level: 0, edges: edgesBetween(a, b, c, d), style: "plaster_cream" });
  bp = apply(bp, { t: "opening.place", level: 0, id: "door000001", catalogId: "door_wood", dir: "h", x: 7, z: 9, flip: false });
  // the bench goes against the wall the window is in; the seats face that wall
  const at: Record<number, { x: number; z: number; win: [("h" | "v"), number, number] }> = {
    0: { x: 5, z: 3, win: ["h", 5, 3] }, // against the north wall, facing -z
    2: { x: 5, z: 8, win: ["h", 5, 9] }, // against the south wall, facing +z
    1: { x: 8, z: 5, win: ["v", 9, 5] }, // (turned a quarter: it faces +x, against the east wall)
    3: { x: 3, z: 5, win: ["v", 3, 5] }, // (and three quarters: faces -x, against the west wall)
  };
  const spot = at[rot]!;
  if (windowed) bp = apply(bp, { t: "opening.place", level: 0, id: "window0001", catalogId: "window_wide", dir: spot.win[0], x: spot.win[1], z: spot.win[2], flip: false });
  return apply(bp, { t: "object.place", level: 0, id: "bench00001", catalogId: "window_bench", x: spot.x, z: spot.z, rot });
}

const MIN = 60_000;
/** A moment well inside a rainy spell, and one inside a dry spell, of the weather's own pattern. */
const wet = (() => {
  const s = Array.from({ length: 50 }, (_, i) => i).find((i) => spellRain(i))!;
  return s * SPELL_MS + spellRain(s)!.start + 30_000;
})();
const dry = (() => {
  const s = Array.from({ length: 50 }, (_, i) => i).find((i) => !spellRain(i))!;
  return s * SPELL_MS + 100_000;
})();

function pair(bp: Blueprint, at = wet - 5 * MIN) {
  const life = new Life(emptyLife());
  life.ensureAvatar("amy", bp, at);
  life.ensureAvatar("ben", bp, at);
  return { life, amy: () => life.state.avatars.amy!, ben: () => life.state.avatars.ben! };
}

describe("a window bench", () => {
  it("has a window behind it, however it's turned", () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const bp = room(rot);
      expect(windowBehind(bp, 0, bp.levels[0]!.objects.bench00001!), `rot ${rot}`).toBe(true);
      expect(windowSeats(bp).has("bench00001")).toBe(true);
    }
  });

  it("doesn't, against a plain wall or in the middle of the room", () => {
    const plain = room(0, false);
    expect(windowBehind(plain, 0, plain.levels[0]!.objects.bench00001!)).toBe(false);
    expect(windowSeats(plain).size).toBe(0);
    const moved = apply(room(0), { t: "object.move", level: 0, id: "bench00001", x: 5, z: 6, rot: 0 });
    expect(windowBehind(moved, 0, moved.levels[0]!.objects.bench00001!)).toBe(false);
    // a window the bench's back isn't against doesn't count
    const side = apply(room(0), { t: "object.move", level: 0, id: "bench00001", x: 3, z: 6, rot: 0 });
    expect(windowBehind(side, 0, side.levels[0]!.objects.bench00001!)).toBe(false);
  });
});

describe("watching the rain", () => {
  it("only when it rains, and only on a window bench with a window behind it", () => {
    const bp = room();
    const { life } = pair(bp, dry - MIN);
    life.state.world = emptyWorld();
    expect(life.rain("amy", bp, "bench00001", false, dry)).toBe("not-raining");
    const plain = room(0, false);
    const p2 = pair(plain);
    expect(p2.life.rain("amy", plain, "bench00001", false, wet)).toBe("no-window");
    // not a window bench at all
    const sofa = apply(room(), { t: "object.place", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 5, z: 6, rot: 0 });
    const p3 = pair(sofa);
    expect(p3.life.rain("amy", sofa, "sofa000001", false, wet)).toBe("not-window-seat");
    expect(p3.life.rain("amy", sofa, "nothingthere", false, wet)).toBe("nothing-to-do");
  });

  it("sits one person on the bench, facing the window, with no bonus alone", () => {
    const bp = room();
    const { life, amy } = pair(bp);
    expect(life.rain("amy", bp, "bench00001", false, wet)).toBeNull();
    const arrive = arrivalTime(amy());
    life.tick(bp, arrive + 100);
    expect(amy().use).toMatchObject({ objectId: "bench00001", action: "sit", pose: { face: 2 } });
    // (north wall: facing -z is rot 2)
    life.tick(bp, wet + MIN);
    expect(amy().use!.action).toBe("sit");
  });

  it("asks the partner over to the other seat, and both get the Social bonus once they're sitting", () => {
    const bp = room();
    const { life, amy, ben } = pair(bp);
    expect(life.rain("amy", bp, "bench00001", true, wet)).toBeNull();
    expect(ben().use).toMatchObject({ objectId: "bench00001", invitedBy: "amy" });
    expect(new Set([amy().use!.slot, ben().use!.slot])).toEqual(new Set([0, 1]));
    // still walking: not together yet
    expect(amy().use!.action).toBe("sit");
    const there = Math.max(arrivalTime(amy()), arrivalTime(ben())) + 200;
    life.tick(bp, there);
    expect(amy().use!.action).toBe("rain");
    expect(ben().use!.action).toBe("rain");
    // both face the window
    expect(amy().use!.pose!.face).toBe(2);
    expect(ben().use!.pose!.face).toBe(2);
    // a minute of it does their Social more good than a minute of plain sitting
    const sitter: Avatar = { ...amy(), use: { ...amy().use!, action: "sit" } };
    const gain = (a: Avatar) => needsAt({ ...a, needs: { v: { hunger: 50, energy: 50, hygiene: 50, bladder: 50, fun: 50, social: 40 }, at: there, live: true } }, there + MIN).social;
    expect(gain(amy())).toBeGreaterThan(gain(sitter) + 8);
    expect(gain(amy())).toBeLessThan(75);
  });

  it("lets either one stand up at any time, which frees the seat and ends the bonus", () => {
    const bp = room();
    const { life, amy, ben } = pair(bp);
    life.rain("amy", bp, "bench00001", true, wet);
    const there = Math.max(arrivalTime(amy()), arrivalTime(ben())) + 200;
    life.tick(bp, there);
    expect(life.stop("ben", there + 5000)).toBeNull();
    expect(ben().use).toBeNull();
    expect(amy().use).toMatchObject({ objectId: "bench00001", action: "sit" });
    // the free seat can be taken again straight away, and the pair is a pair again
    expect(life.rain("ben", bp, "bench00001", false, there + 6000)).toBeNull();
    life.tick(bp, arrivalTime(ben()) + 100);
    expect(amy().use!.action).toBe("rain");
    // getting up while walking over works too
    life.stop("amy", arrivalTime(ben()) + 200);
    expect(amy().use).toBeNull();
    expect(ben().use!.action).toBe("sit");
  });

  it("when the rain stops they stay seated, without the bonus, and it comes back with the rain", () => {
    const bp = room();
    const { life, amy, ben } = pair(bp);
    // forced rain that's then forced off
    life.state.world = { dayShift: 0, weather: { mode: "rain", at: wet - 60_000, from: 0 } };
    life.rain("amy", bp, "bench00001", true, wet);
    life.tick(bp, Math.max(arrivalTime(amy()), arrivalTime(ben())) + 200);
    expect(amy().use!.action).toBe("rain");
    life.state.world = { dayShift: 0, weather: { mode: "clear", at: wet + 20_000, from: 1 } };
    life.tick(bp, wet + 40_000);
    expect(amy().use!.action).toBe("sit");
    expect(ben().use!.action).toBe("sit");
    life.state.world = { dayShift: 0, weather: { mode: "rain", at: wet + 50_000, from: 0 } };
    life.tick(bp, wet + 70_000);
    expect(amy().use!.action).toBe("rain");
  });

  it("is told when the rain changes, so the server wakes up for it", () => {
    const bp = room();
    const { life, amy } = pair(bp);
    life.state.world = { dayShift: 0, weather: { mode: "rain", at: wet - 60_000, from: 0 } };
    life.rain("amy", bp, "bench00001", false, wet);
    life.tick(bp, arrivalTime(amy()) + 100);
    // nothing to wait for until the rain's due to change, and it never does while it's forced on
    expect(life.nextEvent(arrivalTime(amy()) + 100)).toBeNull();
    life.state.world = { dayShift: 0, weather: { mode: "clear", at: wet + 3 * MIN, from: 1 } };
    const next = life.nextEvent(wet + MIN)!;
    expect(next).toBeGreaterThan(wet + 3 * MIN);
    expect(next).toBeLessThan(wet + 3 * MIN + 30_000);
  });

  it("won't send the partner anywhere it can't get to, and leaves everyone where they were", () => {
    // Ben is shut in a little walled box with no door
    let bp = room();
    for (const [x1, z1, x2, z2] of [
      [11, 11, 13, 11],
      [13, 11, 13, 13],
      [13, 13, 11, 13],
      [11, 13, 11, 11],
    ] as const)
      bp = apply(bp, { t: "walls.add", level: 0, edges: edgesBetween(x1, z1, x2, z2), style: "plaster_cream" });
    const { life, amy, ben } = pair(bp);
    life.state.avatars.ben!.path = [[12, 12]];
    const before = JSON.stringify([amy(), ben()]);
    expect(life.rain("amy", bp, "bench00001", true, wet)).toBe("unreachable");
    // nobody moved, and Amy can still sit there alone
    expect(JSON.stringify([amy(), ben()])).toBe(before);
    expect(life.rain("amy", bp, "bench00001", false, wet)).toBeNull();
    expect(amy().use!.objectId).toBe("bench00001");
  });

  it("won't invite a partner who's busy cooking or asleep, or away", () => {
    const bp = apply(room(), { t: "object.place", level: 0, id: "bed0000001", catalogId: "bed_double", x: 6, z: 6, rot: 0 });
    const { life, ben } = pair(bp);
    life.use("ben", bp, "bed0000001", "sleep", wet - 30_000);
    expect(life.rain("amy", bp, "bench00001", true, wet)).toBe("partner-busy");
    expect(ben().use!.action).toBe("sleep");
    // without an invitation you can still sit there yourself
    expect(life.rain("amy", bp, "bench00001", false, wet)).toBeNull();
    const alone = new Life(emptyLife());
    alone.ensureAvatar("amy", bp, wet - MIN);
    expect(alone.rain("amy", bp, "bench00001", true, wet)).toBe("partner-away");
  });

  it("keeps an occupied seat occupied: asking again changes nothing, and a taken bench is refused", () => {
    const bp = room();
    const { life, amy, ben } = pair(bp);
    life.rain("amy", bp, "bench00001", true, wet);
    const there = Math.max(arrivalTime(amy()), arrivalTime(ben())) + 200;
    life.tick(bp, there);
    const before = JSON.stringify([amy().use, ben().use]);
    expect(life.rain("amy", bp, "bench00001", true, there + 1000)).toBeNull();
    expect(life.rain("ben", bp, "bench00001", false, there + 1000)).toBeNull();
    expect(JSON.stringify([amy().use, ben().use])).toBe(before);
    // a third seat doesn't exist: someone else's character can't squeeze on (the bench has two)
    const solo = pair(bp);
    solo.life.rain("amy", bp, "bench00001", false, wet);
    solo.life.rain("ben", bp, "bench00001", false, wet);
    expect(new Set([solo.amy().use!.slot, solo.ben().use!.slot])).toEqual(new Set([0, 1]));
  });

  it("survives being saved and restored mid-rain: still sitting, bonus back once the first tick comes", () => {
    const bp = room();
    const { life, amy, ben } = pair(bp);
    life.state.world = { dayShift: 0, weather: { mode: "rain", at: wet - 60_000, from: 0 } };
    life.rain("amy", bp, "bench00001", true, wet);
    const there = Math.max(arrivalTime(amy()), arrivalTime(ben())) + 200;
    life.tick(bp, there);
    const restored = Life.restore(life.saved(there + 5000), there + 5000);
    restored.onBlueprint(bp, there + 5000);
    expect(restored.state.avatars.amy!.use).toMatchObject({ objectId: "bench00001" });
    restored.tick(bp, there + 6000);
    expect(restored.state.avatars.amy!.use!.action).toBe("rain");
    expect(restored.state.avatars.ben!.use!.action).toBe("rain");
  });
});
