import { describe, expect, it } from "vitest";
import { emptyBlueprint } from "../blueprint";
import { catalog } from "../catalog";
import { Life } from "../life/engine";
import { START_NEEDS } from "../life/needs";
import { emptyLife, LEFTOVER_MS } from "../life/state";
import { Op } from "../ops";
import { applyOp } from "../rules";
import { withStarterHouse } from "../starter";

let n = 0;
const ids = () => `id${String(++n).padStart(8, "0")}`;

describe("recipes", () => {
  const recipes = [...catalog.recipes.values()];

  it("has plenty to choose from, each with its own name", () => {
    expect(recipes.length).toBeGreaterThanOrEqual(12);
    expect(new Set(recipes.map((r) => r.name.toLowerCase())).size).toBe(recipes.length);
  });

  it.each(recipes.map((r) => [r.id]))("%s can be cooked in the starter kitchen, and ends up on a plate", (id) => {
    const bp = withStarterHouse(emptyBlueprint(24, 20), ids);
    const life = new Life(emptyLife(), catalog, ids);
    life.ensureAvatar("amy", bp, 0);
    expect(life.cook("amy", bp, id, null, 0)).toBeNull();
    let t = 0;
    while (life.state.cooking && t < 10 * 60_000) {
      t = Math.max(t + 250, life.nextEvent(t) ?? t + 1000);
      life.tick(bp, t);
      // over to the next step's station once this one's done, as a player would
      const c = life.state.cooking;
      const step = c && catalog.recipes.get(c.recipeId)!.steps[c.step];
      if (step && life.state.avatars.amy!.use?.station !== step.station) life.help("amy", bp, t);
    }
    expect(life.state.cooking).toBeNull();
    expect(life.state.dishes.some((d) => d.recipeId === id && d.portions === catalog.recipes.get(id)!.serves)).toBe(true);
  });
});

describe("leftovers and the fridge", () => {
  const T = 1_000_000;
  /** A meal cooked and served in the starter house, with nobody eating it. */
  function served() {
    const bp = withStarterHouse(emptyBlueprint(24, 20), ids);
    const life = new Life(emptyLife(), catalog, ids);
    life.ensureAvatar("amy", bp, T);
    life.ensureAvatar("ben", bp, T);
    life.cook("amy", bp, "salad", null, T);
    let t = T;
    while (life.state.cooking) {
      t = Math.max(t + 250, life.nextEvent(t) ?? t + 1000);
      life.tick(bp, t);
    }
    return { bp, life, t, dish: life.state.dishes[0]! };
  }

  it("puts a plate nobody's touched for half an hour in the fridge, and says when", () => {
    const { bp, life, t, dish } = served();
    expect(dish.servedAt).toBe(t);
    expect(life.nextEvent(t + 1)).toBe(t + LEFTOVER_MS);
    life.tick(bp, t + LEFTOVER_MS - 1);
    expect(life.state.dishes).toHaveLength(1);
    expect(life.tick(bp, t + LEFTOVER_MS)).toBe(true);
    expect(life.state.dishes).toHaveLength(0);
    expect(life.state.fridge).toEqual([{ id: dish.id, recipeId: "salad", portions: 2, storedAt: t + LEFTOVER_MS }]);
  });

  it("starts the half hour again whenever someone eats from it", () => {
    const { bp, life, t, dish } = served();
    expect(life.eat("ben", bp, dish.id, t + 20 * 60_000)).toBeNull();
    let at = t + 20 * 60_000;
    while (life.state.avatars.ben!.use?.action === "eat") life.tick(bp, (at = Math.max(at + 250, life.nextEvent(at) ?? at + 1000)));
    expect(dish.portions).toBe(1);
    life.tick(bp, t + LEFTOVER_MS + 1000);
    expect(life.state.dishes).toEqual([dish]);
    life.tick(bp, dish.servedAt! + LEFTOVER_MS);
    expect(life.state.fridge?.map((l) => l.portions)).toEqual([1]);
  });

  it("leaves it out when there's no fridge, and saves what's in it", () => {
    const { bp, life, t, dish } = served();
    const fridge = Object.values(bp.levels[0]!.objects).find((o) => o.catalogId === "fridge")!;
    const without = applyOp(bp, Op.parse({ t: "object.remove", level: 0, id: fridge.id }));
    if (!without.ok) throw new Error(without.reason);
    life.tick(without.blueprint, t + LEFTOVER_MS);
    expect(life.state.dishes).toEqual([dish]);
    // and nothing's due again for another half hour
    expect(life.nextEvent(t + LEFTOVER_MS)).toBe(t + 2 * LEFTOVER_MS);
    // with the fridge, it goes in, and it's still there after a save
    life.tick(bp, t + 2 * LEFTOVER_MS);
    const again = Life.restore(life.saved(t + 2 * LEFTOVER_MS), T + 99, catalog);
    expect(again.state.fridge).toHaveLength(1);
  });

  it("takes a meal out onto the table by the fridge, and you sit down to it", () => {
    const { bp, life, t, dish } = served();
    expect(life.store(bp, dish.id, t)).toBeNull();
    expect(life.store(bp, dish.id, t)).toBe("no-dish");
    expect(life.takeOut("amy", bp, dish.id, null, true, t + 1000)).toBeNull();
    expect(life.state.fridge).toEqual([]);
    expect(life.state.dishes).toMatchObject([{ recipeId: "salad", portions: 2, servedAt: t + 1000 }]);
    expect(life.state.avatars.amy!.use).toMatchObject({ action: "eat", dishId: life.state.dishes[0]!.id });
  });

  it("is where free will looks before cooking something new", () => {
    const { bp, life, t, dish } = served();
    life.store(bp, dish.id, t);
    const hungry = new Life(life.saved(t), catalog, ids, () => 0.5).enableFreeWill();
    hungry.state.avatars.amy!.needs = { v: { ...START_NEEDS, hunger: 10 }, at: t, live: true };
    hungry.tick(bp, t + 1000);
    expect(hungry.state.cooking).toBeNull();
    expect(hungry.state.fridge).toEqual([]);
    expect(hungry.state.avatars.amy!.use).toMatchObject({ action: "eat", dishId: hungry.state.dishes[0]!.id });
  });
});
