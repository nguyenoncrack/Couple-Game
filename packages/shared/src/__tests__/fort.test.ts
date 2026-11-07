import { describe, expect, it } from "vitest";
import {
  activityAt,
  anchorsAt,
  applyOp,
  arrivalTime,
  catalog,
  emptyBlueprint,
  emptyLife,
  fortMoveOps,
  inverseOp,
  Life,
  Op,
  PATTERNS,
  piecesOn,
  restoredForts,
  slotsOf,
  snapPiece,
  snapUnder,
  type Blueprint,
  type PlacedObject,
  type Rot,
} from "../index";

const apply = (bp: Blueprint, op: Op) => {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw Error(r.reason);
  return r.blueprint;
};
const frameAt = (bp: Blueprint, rot: Rot = 0, x = 6, z = 6, id = "fort0000001") => apply(bp, { t: "object.place", level: 0, id, catalogId: "fort_frame", x, z, rot });
const ROTS = [0, 1, 2, 3] as const;

/** Place one of each kit piece on each of its snap points. */
function dress(bp: Blueprint, id = "fort0000001") {
  const frame = bp.levels[0]!.objects[id]!;
  let out = bp;
  let n = 0;
  for (const p of anchorsAt(frame)) {
    const catalogId = { mat: "fort_mat", cushion: "fort_cushion", plush: "fort_plush", lights: "fort_fairy_lights" }[p.anchor.role];
    out = apply(out, { t: "object.place", level: 0, id: `piece${String(n++).padStart(6, "0")}`, catalogId, x: p.x, z: p.z, rot: p.anchor.turns ? frame.rot : 0 });
  }
  return out;
}

describe("the blanket fort kit", () => {
  it("is in the catalog with a price, search terms and a thumbnail-ready model for every piece", () => {
    const kit = [...catalog.furniture.values()].filter((i) => i.fort);
    expect(kit.map((i) => i.id).sort()).toEqual(["fort_cushion", "fort_fairy_lights", "fort_frame", "fort_mat", "fort_plush"]);
    for (const item of kit) {
      expect(item.category).toBe("fort");
      expect(item.price).toBeGreaterThan(0);
      expect(item.tags!.length).toBeGreaterThanOrEqual(5);
      expect(item.tags).toContain("fort");
      expect(item.model.kind).toBeTruthy();
    }
    expect(PATTERNS).toHaveLength(3);
  });

  it("has two seats in the frame, both with a way in", () => {
    const slots = slotsOf({ id: "fort0000001", catalogId: "fort_frame", x: 6, z: 6, rot: 0 }, "fort");
    expect(slots).toHaveLength(2);
    expect(slots[0]!.pose.face).not.toBe(slots[1]!.pose.face);
  });

  it.each(ROTS)("takes every piece on its snap points at rotation %i, all at once, and survives a save", (rot) => {
    const bp = dress(frameAt(emptyBlueprint(16, 16), rot));
    const frame = bp.levels[0]!.objects["fort0000001"]!;
    expect(Object.keys(piecesOn(bp.levels[0]!, frame, catalog)).sort()).toEqual(["lights", "mat", "plush", "seat-left", "seat-right"]);
    expect(JSON.parse(JSON.stringify(bp))).toEqual(bp);
  });

  it("only lets pieces go on a snap point, and one piece to a point", () => {
    const bp = frameAt(emptyBlueprint(16, 16));
    // right at the fort but not on a marked spot
    expect(applyOp(bp, { t: "object.place", level: 0, id: "cushion0001", catalogId: "fort_cushion", x: 7, z: 6, rot: 0 })).toEqual({ ok: false, reason: "needs-fort" });
    // nowhere near one
    expect(applyOp(emptyBlueprint(16, 16), { t: "object.place", level: 0, id: "cushion0001", catalogId: "fort_cushion", x: 2, z: 2, rot: 0 })).toEqual({ ok: false, reason: "needs-fort" });
    const seat = anchorsAt(bp.levels[0]!.objects["fort0000001"]!, "cushion")[0]!;
    const once = apply(bp, { t: "object.place", level: 0, id: "cushion0001", catalogId: "fort_cushion", x: seat.x, z: seat.z, rot: 0 });
    expect(applyOp(once, { t: "object.place", level: 0, id: "cushion0002", catalogId: "fort_cushion", x: seat.x, z: seat.z, rot: 0 })).toEqual({ ok: false, reason: "overlaps" });
    // the lights and the mat have to face the way the fort does
    const lights = anchorsAt(bp.levels[0]!.objects["fort0000001"]!, "lights")[0]!;
    expect(applyOp(bp, { t: "object.place", level: 0, id: "lights00001", catalogId: "fort_fairy_lights", x: lights.x, z: lights.z, rot: 2 })).toEqual({ ok: false, reason: "needs-fort" });
  });

  it("works upstairs too, with floor laid under it", () => {
    let bp = apply(emptyBlueprint(16, 16), { t: "level.add", level: 1 });
    const cells = Array.from({ length: 16 }, (_, x) => Array.from({ length: 16 }, (_, z) => `${x}:${z}`)).flat();
    bp = apply(bp, { t: "floor.paint", level: 1, cells, material: "oak" });
    bp = apply(bp, { t: "object.place", level: 1, id: "fort0000001", catalogId: "fort_frame", x: 4, z: 4, rot: 1 });
    const seat = anchorsAt(bp.levels[1]!.objects["fort0000001"]!, "cushion")[0]!;
    bp = apply(bp, { t: "object.place", level: 1, id: "cushion0001", catalogId: "fort_cushion", x: seat.x, z: seat.z, rot: 0 });
    expect(bp.levels[0]!.objects).toEqual({});
  });

  it("snaps a piece held near a fort to the closest free spot, and to nothing when there's none", () => {
    const bp = dress(frameAt(emptyBlueprint(16, 16)));
    const level = bp.levels[0]!;
    const cushion = catalog.furniture.get("fort_cushion")!;
    // all the seats are taken
    expect(snapPiece(level, cushion, { x: 7, z: 7 }, catalog)).toBeNull();
    const bare = frameAt(emptyBlueprint(16, 16));
    const near = snapPiece(bare.levels[0]!, cushion, { x: 6.4, z: 7.6 }, catalog)!;
    expect(snapUnder(bare.levels[0]!, "cushion", { ...near }, catalog)).not.toBeNull();
    // far away
    expect(snapPiece(bare.levels[0]!, cushion, { x: 1, z: 1 }, catalog)).toBeNull();
  });

  it.each(ROTS)("moves and turns with its pieces, in one step that undo reverses exactly (from rotation %i)", (rot) => {
    const dressed = dress(frameAt(emptyBlueprint(20, 20), rot));
    for (const to of [{ x: 10, z: 9, rot: 3 as Rot }, { x: 2, z: 12, rot: 0 as Rot }, { x: 12, z: 3, rot: 1 as Rot }]) {
      const ops = fortMoveOps(dressed, 0, "fort0000001", to, catalog);
      expect(ops).toHaveLength(6);
      const op: Op = { t: "batch", ops };
      const moved = apply(dressed, op);
      const frame = moved.levels[0]!.objects["fort0000001"]!;
      expect(frame).toMatchObject(to);
      expect(Object.keys(piecesOn(moved.levels[0]!, frame, catalog)).sort()).toEqual(["lights", "mat", "plush", "seat-left", "seat-right"]);
      expect(apply(moved, inverseOp(dressed, op)!)).toEqual(dressed);
    }
  });

  it("leaves pieces where they are if the fort is sold, and a piece can't then be moved off a fort", () => {
    const bp = dress(frameAt(emptyBlueprint(16, 16)));
    const gone = apply(bp, { t: "object.remove", level: 0, id: "fort0000001" });
    expect(Object.keys(gone.levels[0]!.objects)).toHaveLength(5);
    const piece = Object.values(bp.levels[0]!.objects).find((o) => o.catalogId === "fort_cushion")!;
    expect(applyOp(bp, { t: "object.move", level: 0, id: piece.id, x: 1, z: 1, rot: 0 })).toEqual({ ok: false, reason: "needs-fort" });
  });
});

describe("a fort's shared settings", () => {
  const house = (rot: Rot = 0) => {
    const bp = dress(frameAt(emptyBlueprint(16, 16), rot));
    const life = new Life(emptyLife());
    return { bp, life };
  };

  it("lets either player pick a pattern and name it, tidying the text", () => {
    const { bp, life } = house();
    expect(life.fort(bp, "fort0000001", { pattern: "stars" })).toEqual({ reject: null, changed: true });
    expect(life.fort(bp, "fort0000001", { name: "  The   Bear\u0000 Den  ", sign: "gone\nfor snacks" })).toEqual({ reject: null, changed: true });
    expect(life.state.forts!["fort0000001"]).toEqual({ name: "The Bear Den", sign: "gone for snacks", pattern: "stars", lit: false });
    expect(life.fort(bp, "fort0000001", { pattern: "stars" })).toEqual({ reject: null, changed: false });
    expect(life.fort(bp, "fort0000001", { name: "x".repeat(100) }).changed).toBe(true);
    expect(life.state.forts!["fort0000001"]!.name).toHaveLength(28);
  });

  it("only has fairy lights on if some are hung, and puts them out when they come down", () => {
    const bare = frameAt(emptyBlueprint(16, 16));
    const life = new Life(emptyLife());
    expect(life.fort(bare, "fort0000001", { lit: true })).toEqual({ reject: "no-lights", changed: false });
    const { bp } = house();
    expect(life.fort(bp, "fort0000001", { lit: true })).toEqual({ reject: null, changed: true });
    const lights = Object.values(bp.levels[0]!.objects).find((o) => o.catalogId === "fort_fairy_lights")!;
    const down = apply(bp, { t: "object.remove", level: 0, id: lights.id });
    expect(life.onBlueprint(down, 1000)).toBe(true);
    expect(life.state.forts!["fort0000001"]!.lit).toBe(false);
  });

  it("turns down a fort that isn't there, and keeps a sold fort's name for Undo (with its lights off)", () => {
    const { bp, life } = house();
    expect(life.fort(bp, "nothing0001", { pattern: "stars" })).toEqual({ reject: "no-fort", changed: false });
    life.fort(bp, "fort0000001", { name: "Den", lit: true });
    const sold = apply(bp, { t: "object.sell", level: 0, id: "fort0000001" });
    life.onBlueprint(sold, 1000);
    expect(life.state.forts!["fort0000001"]).toMatchObject({ name: "Den", lit: false });
    // bought back: the name is there again
    const back = apply(sold, inverseOp(bp, { t: "object.sell", level: 0, id: "fort0000001" })!);
    life.onBlueprint(back, 2000);
    expect(life.fort(back, "fort0000001", { lit: true }).reject).toBeNull();
    expect(life.state.forts!["fort0000001"]!.name).toBe("Den");
  });

  it("lets go of the settings of many long-gone forts", () => {
    const { bp, life } = house();
    for (let i = 0; i < 12; i++) life.state.forts = { ...life.state.forts, [`gone${String(i).padStart(7, "0")}`]: { name: `n${i}`, sign: "", pattern: "gingham", lit: false } };
    life.onBlueprint(bp, 1000);
    expect(Object.keys(life.state.forts!)).toHaveLength(8);
  });

  it("is saved with the house and read back safely, and older houses have none", () => {
    const { bp, life } = house();
    life.fort(bp, "fort0000001", { pattern: "patchwork", name: "Den", sign: "knock first", lit: true });
    const saved = JSON.parse(JSON.stringify(life.saved(5000)));
    const again = Life.restore(saved, 6000);
    expect(again.state.forts).toEqual(life.state.forts);
    expect(restoredForts({ f: { name: 3, sign: "<b>hi</b>", pattern: "nope", lit: "yes" } })).toEqual({ f: { name: "", sign: "<b>hi</b>", pattern: "gingham", lit: false } });
    expect(restoredForts(undefined)).toBeUndefined();
    expect(Life.restore(JSON.parse(JSON.stringify(new Life(emptyLife()).saved(1))), 2).state.forts).toBeUndefined();
  });

  it("seats both players at once, one in each seat, and gets them out cleanly", () => {
    const { bp, life } = house();
    life.ensureAvatar("playerAAAAA", bp, 1000);
    life.ensureAvatar("playerBBBBB", bp, 1000);
    expect(life.use("playerAAAAA", bp, "fort0000001", "fort", 1000)).toBeNull();
    expect(life.use("playerBBBBB", bp, "fort0000001", "fort", 1000)).toBeNull();
    const [a, b] = [life.state.avatars["playerAAAAA"]!, life.state.avatars["playerBBBBB"]!];
    expect(a.use!.slot).not.toBe(b.use!.slot);
    const later = Math.max(arrivalTime(a), arrivalTime(b)) + 100;
    expect(activityAt(a, later)).toBe("fort");
    expect(activityAt(b, later)).toBe("fort");
    // a third can't squeeze in
    life.ensureAvatar("playerCCCCC", bp, 1000);
    expect(life.use("playerCCCCC", bp, "fort0000001", "fort", 1000)).toBe("taken");
    // leaving: stand up, and walking off, are the same clean exit
    expect(life.stop("playerAAAAA", later)).toBeNull();
    expect(life.state.avatars["playerAAAAA"]!.use).toBeNull();
    expect(life.walk("playerBBBBB", bp, [1, 1], later)).toBeNull();
    expect(life.state.avatars["playerBBBBB"]!.use).toBeNull();
  });

  it("puts out anyone inside when the fort is sold or moved", () => {
    const { bp, life } = house();
    life.ensureAvatar("playerAAAAA", bp, 1000);
    life.use("playerAAAAA", bp, "fort0000001", "fort", 1000);
    expect(life.state.avatars["playerAAAAA"]!.use?.action).toBe("fort");
    const sold = apply(bp, { t: "object.sell", level: 0, id: "fort0000001" });
    life.onBlueprint(sold, 5000);
    expect(life.state.avatars["playerAAAAA"]!.use).toBeNull();
  });
});

describe("pieces of the kit left on their own", () => {
  it("can be sold like any furniture", () => {
    const bp = dress(frameAt(emptyBlueprint(16, 16)));
    const plush = Object.values(bp.levels[0]!.objects).find((o: PlacedObject) => o.catalogId === "fort_plush")!;
    const sold = apply(bp, { t: "object.sell", level: 0, id: plush.id });
    expect(sold.levels[0]!.objects[plush.id]).toBeUndefined();
    expect(apply(sold, inverseOp(bp, { t: "object.sell", level: 0, id: plush.id })!)).toEqual(bp);
  });
});
