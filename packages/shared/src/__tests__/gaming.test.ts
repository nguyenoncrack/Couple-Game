import { describe, expect, it } from "vitest";
import { emptyBlueprint, type Blueprint } from "../blueprint";
import { LifeIntent } from "../protocol";
import { applyOp } from "../rules";
import type { Op } from "../ops";
import type { Rot } from "../grid";
import { Life } from "../life/engine";
import { arrivalTime, emptyLife } from "../life/state";

function apply(bp: Blueprint, op: Op) {
  const result = applyOp(bp, op);
  if (!result.ok) throw Error(result.reason);
  return result.blueprint;
}
const place = (bp: Blueprint, id: string, catalogId: string, x: number, z: number, rot: Rot = 0) =>
  apply(bp, { t: "object.place", level: 0, id, catalogId, x, z, rot });
function room(seat = false) {
  let bp = place(emptyBlueprint(12, 12), "tv00000001", "tv_stand", 3, 1);
  bp = place(bp, "console001", "ps5_setup", 6, 1);
  if (seat) bp = place(bp, "sofa000001", "sofa_cozy", 3, 5, 2);
  return bp;
}
function two(bp: Blueprint) {
  const life = new Life(emptyLife());
  life.ensureAvatar("amy", bp, 0);
  life.ensureAvatar("ben", bp, 0);
  return { life, amy: () => life.state.avatars.amy!, ben: () => life.state.avatars.ben! };
}

describe("PS5 gaming", () => {
  it("accepts a play intent and reserves different sofa seats for both players", () => {
    const bp = room(true);
    const { life, amy, ben } = two(bp);
    expect(LifeIntent.parse({ do: "use", objectId: "console001", action: "play" })).toMatchObject({ action: "play" });
    expect(life.use("amy", bp, "console001", "play", 0)).toBeNull();
    expect(life.use("ben", bp, "console001", "play", 0)).toBeNull();
    for (const a of [amy(), ben()]) expect(a.use).toMatchObject({ objectId: "sofa000001", action: "play", tv: "tv00000001", consoleId: "console001", pose: { face: 2, y: 0.45 } });
    expect(amy().use!.slot).not.toBe(ben().use!.slot);
    expect(life.use("ben", bp, "sofa000001", "sit", 0)).toBeNull();
    expect(ben().use!.slot).not.toBe(amy().use!.slot);
  });

  it("uses the closest TV to the console, even when another TV is closer to the player", () => {
    const bp = place(room(true), "tv00000002", "tv_stand", 6, 10, 2);
    const { life, amy } = two(bp);
    expect(life.use("amy", bp, "console001", "play", 0)).toBeNull();
    expect(amy().use!.tv).toBe("tv00000001");
  });

  it("sits on separate floor spots facing the TV when there is no usable seat", () => {
    const bp = place(room(), "chair00001", "dining_chair", 3, 5); // faces away from TV
    const { life, amy, ben } = two(bp);
    expect(life.use("amy", bp, "console001", "play", 0)).toBeNull();
    expect(life.use("ben", bp, "console001", "play", 0)).toBeNull();
    for (const a of [amy(), ben()]) expect(a.use).toMatchObject({ objectId: "tv00000001", action: "play", tv: "tv00000001", consoleId: "console001", pose: { y: 0, face: 2 } });
    expect(amy().use!.slot).not.toBe(ben().use!.slot);
    expect(life.use("ben", bp, "tv00000001", "watch", 0)).toBeNull();
    expect(ben().use!.slot).not.toBe(amy().use!.slot);
  });

  it.each([0, 1, 2, 3] as const)("faces a rotated TV from the floor (rotation %s)", (rot) => {
    let bp = place(emptyBlueprint(12, 12), "tv00000001", "tv_stand", 4, 4, rot);
    bp = place(bp, "console001", "ps5_setup", 1, 1);
    const { life, amy } = two(bp);
    expect(life.use("amy", bp, "console001", "play", 0)).toBeNull();
    expect(amy().use!.pose).toMatchObject({ face: (rot + 2) % 4, y: 0 });
  });

  it("falls back to the floor when the only chair is taken, and releases the controller when stopped", () => {
    const bp = place(room(), "chair00001", "dining_chair", 3, 5, 2);
    const { life, amy, ben } = two(bp);
    expect(life.use("amy", bp, "chair00001", "sit", 0)).toBeNull();
    expect(life.use("ben", bp, "console001", "play", 0)).toBeNull();
    expect(ben().use!.pose!.y).toBe(0);
    const arrived = arrivalTime(ben()) + 1;
    expect(life.stop("ben", arrived)).toBeNull();
    expect(ben().use).toBeNull();
    expect(amy().use!.action).toBe("sit");
  });

  it("rejects a missing TV or a forged play action without changing what the player was doing", () => {
    let bp = place(emptyBlueprint(12, 12), "console001", "ps5_setup", 6, 1);
    bp = place(bp, "chair00001", "dining_chair", 3, 5);
    const { life } = two(bp);
    life.use("amy", bp, "chair00001", "sit", 0);
    const before = structuredClone(life.state);
    expect(life.use("amy", bp, "console001", "play", 1)).toBe("no-tv");
    expect(life.use("amy", bp, "chair00001", "play", 1)).toBe("nothing-to-do");
    expect(life.state).toEqual(before);
  });

  it("won't use a screen through a solid wall or settle on blocked floor spots", () => {
    let bp = apply(room(), { t: "walls.add", level: 0, edges: Array.from({ length: 12 }, (_, x) => `h:${x}:2`), style: "plaster_cream" });
    const walled = two(bp);
    expect(walled.life.use("amy", bp, "console001", "play", 0)).toBe("unreachable");
    bp = place(room(), "blocked001", "coffee_table_oak", 3, 3);
    const blocked = two(bp);
    expect(blocked.life.use("amy", bp, "console001", "play", 0)).toBe("unreachable");
    expect(blocked.amy().use).toBeNull();
  });

  it.each([false, true])("ends gaming safely when its console or TV is removed (floor=%s)", (floor) => {
    for (const removed of ["console001", "tv00000001"]) {
      let bp = room(!floor);
      const { life, amy } = two(bp);
      life.use("amy", bp, "console001", "play", 0);
      bp = apply(bp, { t: "object.remove", level: 0, id: removed });
      expect(life.onBlueprint(bp, 60_000)).toBe(true);
      if (floor) expect(amy().use).toBeNull();
      else expect(amy().use).toMatchObject({ action: "sit", consoleId: undefined, tv: undefined });
    }
  });

  it("keeps gaming after unrelated edits and a saved life-state round trip", () => {
    let bp = room(true);
    const { life, amy } = two(bp);
    life.use("amy", bp, "console001", "play", 0);
    const saved = JSON.parse(JSON.stringify(life.state));
    const restored = new Life(saved);
    bp = place(bp, "plant00001", "plant_fiddle", 10, 10);
    expect(restored.onBlueprint(bp, 60_000)).toBe(false);
    expect(restored.state.avatars.amy!.use).toEqual(amy().use);
    bp = apply(bp, { t: "object.move", level: 0, id: "sofa000001", x: 8, z: 5, rot: 2 });
    expect(restored.onBlueprint(bp, 60_001)).toBe(true);
    expect(restored.state.avatars.amy!.use).toBeNull();
  });
});
