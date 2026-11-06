import { describe, expect, it } from "vitest";
import { applyOp, catalog, costOf, emptyBlueprint, inverseOp, Op, RESALE, resaleValue, STARTING_FUNDS, undoCheck, upgradeBlueprint, type Blueprint } from "../index";

const apply = (bp: Blueprint, op: Op) => {
  const r = applyOp(bp, Op.parse(op));
  if (!r.ok) throw Error(r.reason);
  return r.blueprint;
};
const place = (bp: Blueprint, id: string, catalogId = "sofa_cozy", x = 4, z = 4) => apply(bp, { t: "object.place", level: 0, id, catalogId, x, z, rot: 0 });
const price = (id: string) => catalog.furniture.get(id)!.price;

describe("selling furniture", () => {
  it("gives back 75% of the price, rounded down, and takes the furniture away", () => {
    expect(RESALE).toBe(0.75);
    const bought = place(emptyBlueprint(), "sofa000001");
    const sold = apply(bought, { t: "object.sell", level: 0, id: "sofa000001" });
    expect(sold.levels[0]!.objects["sofa000001"]).toBeUndefined();
    expect(sold.funds).toBe(STARTING_FUNDS - price("sofa_cozy") + resaleValue(catalog.furniture.get("sofa_cozy")!));
    expect(resaleValue({ price: 101 })).toBe(75);
  });

  it("is never worth more than what it cost, for any item", () => {
    for (const item of catalog.furniture.values()) expect(resaleValue(item)).toBeLessThanOrEqual(item.price);
  });

  it("is turned down when there's nothing there, and costOf reports the (negative) cost", () => {
    const bp = emptyBlueprint();
    expect(applyOp(bp, { t: "object.sell", level: 0, id: "nothing0001" })).toEqual({ ok: false, reason: "not-found" });
    const bought = place(bp, "sofa000001");
    expect(costOf(bought, { t: "object.sell", level: 0, id: "sofa000001" })).toBe(-resaleValue(catalog.furniture.get("sofa_cozy")!));
  });

  it("undo buys it back for what it sold for, leaving the house exactly as it was", () => {
    const bought = place(emptyBlueprint(), "sofa000001");
    const op: Op = { t: "object.sell", level: 0, id: "sofa000001" };
    const sold = apply(bought, op);
    const undo = inverseOp(bought, op)!;
    expect(undo.t).toBe("object.restore");
    expect(apply(sold, undo)).toEqual(bought);
    // and redo sells it again
    const redo = inverseOp(sold, undo)!;
    expect(redo).toEqual(op);
    expect(apply(apply(sold, undo), redo)).toEqual(sold);
  });

  it("can't be used to buy furniture at a discount: only what was sold comes back, once", () => {
    const bought = place(emptyBlueprint(), "sofa000001");
    const sold = apply(bought, { t: "object.sell", level: 0, id: "sofa000001" });
    const back: Op = { t: "object.restore", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 4, z: 4, rot: 0 };
    // never sold
    expect(applyOp(emptyBlueprint(), back)).toEqual({ ok: false, reason: "not-found" });
    // something else under the same ID
    expect(applyOp(sold, { ...back, catalogId: "bed_double" })).toEqual({ ok: false, reason: "not-found" });
    // once
    const again = apply(sold, back);
    expect(applyOp(again, back).ok).toBe(false);
    expect(again.sold).toBeUndefined();
  });

  it("refuses to restore onto something that has since taken the spot", () => {
    const bought = place(emptyBlueprint(), "sofa000001");
    const sold = apply(bought, { t: "object.sell", level: 0, id: "sofa000001" });
    const blocked = place(sold, "chair000001", "sofa_cozy", 4, 4);
    expect(applyOp(blocked, { t: "object.restore", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 4, z: 4, rot: 0 })).toEqual({ ok: false, reason: "overlaps" });
  });

  it("can't buy back more than the house can afford", () => {
    const bought = place(emptyBlueprint(), "sofa000001");
    const sold = apply(bought, { t: "object.sell", level: 0, id: "sofa000001" });
    const poor = { ...sold, funds: 0 };
    expect(applyOp(poor, { t: "object.restore", level: 0, id: "sofa000001", catalogId: "sofa_cozy", x: 4, z: 4, rot: 0 })).toEqual({ ok: false, reason: "cant-afford" });
  });

  it("remembers only the last few dozen sales, and older houses (and saves) are unchanged", () => {
    let bp = emptyBlueprint(40, 40);
    for (let i = 0; i < 45; i++) {
      const id = `lamp${String(i).padStart(6, "0")}`;
      bp = apply(place(bp, id, "sofa_cozy", (i % 10) * 3, Math.floor(i / 10) * 3), { t: "object.sell", level: 0, id });
    }
    expect(Object.keys(bp.sold!)).toHaveLength(40);
    expect(bp.sold!["lamp000000"]).toBeUndefined();
    expect(upgradeBlueprint(JSON.parse(JSON.stringify(bp)))).toEqual(bp);
    expect(emptyBlueprint().sold).toBeUndefined();
  });

  it("changes the undo fingerprint when that spot changes, like any other furniture edit", () => {
    const bought = place(emptyBlueprint(), "sofa000001");
    const op: Op = { t: "object.sell", level: 0, id: "sofa000001" };
    const sold = apply(bought, op);
    expect(undoCheck(sold, op)).not.toBe(undoCheck(bought, op));
  });

  it("works inside a batch, so one sale can pay for the next purchase (200 + 487 covers 650)", () => {
    const bought = place(emptyBlueprint(), "sofa000001");
    const after = apply({ ...bought, funds: 200 }, { t: "batch", ops: [{ t: "object.sell", level: 0, id: "sofa000001" }, { t: "object.place", level: 0, id: "lamp000001", catalogId: "sofa_cozy", x: 8, z: 8, rot: 0 }] });
    expect(after.funds).toBe(200 + resaleValue(catalog.furniture.get("sofa_cozy")!) - price("sofa_cozy"));
  });
});
