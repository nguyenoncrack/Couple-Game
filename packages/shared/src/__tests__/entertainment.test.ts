import { expect, it } from "vitest";
import { catalog } from "../catalog";
import { emptyBlueprint } from "../blueprint";
import { applyOp, footprintOf } from "../rules";
import { slotsOf } from "../life/interactions";
import { Life } from "../life/engine";
import { emptyLife } from "../life/state";
import { buildNav, walkable } from "../life/nav";

it.each(["ping_pong_table", "ps5_setup", "blackjack_table"])("%s places in every rotation, persists, and blocks its footprint", (catalogId) => {
  const item = catalog.furniture.get(catalogId)!;
  expect(item.category).toBe("entertainment");
  expect(item.surface).not.toBe(true);
  for (const rot of [0, 1, 2, 3] as const) {
    const object = { id: "entert0001", catalogId, x: 4, z: 4, rot };
    const placed = applyOp(emptyBlueprint(12, 12), { t: "object.place", level: 0, ...object });
    expect(placed.ok).toBe(true);
    if (!placed.ok) throw new Error(placed.reason);
    const restored = JSON.parse(JSON.stringify(placed.blueprint));
    expect(restored.levels[0].objects[object.id]).toMatchObject(object);
    if (catalogId !== "ps5_setup") expect(slotsOf(object)).toEqual([]);
    else expect(slotsOf(object).every((s) => s.action === "play")).toBe(true);
    const nav = buildNav(placed.blueprint);
    const f = footprintOf(item, object);
    expect(walkable(nav, f.x, f.z)).toBe(false);
    expect(walkable(nav, f.x - 1, f.z)).toBe(true);
    const life = new Life(emptyLife());
    life.ensureAvatar("player0001", placed.blueprint, 1000);
    const before = structuredClone(life.state);
    expect(life.use("player0001", placed.blueprint, object.id, "sit", 1000)).toBe("nothing-to-do");
    expect(life.state).toEqual(before);
    const removed = applyOp(placed.blueprint, { t: "object.remove", level: 0, id: object.id });
    expect(removed.ok && Object.keys(removed.blueprint.levels[0]!.objects)).toHaveLength(0);
  }
});
