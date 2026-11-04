import { describe, expect, it } from "vitest";
import { emptyBlueprint } from "../blueprint";
import { catalog } from "../catalog";
import { Life } from "../life/engine";
import { emptyLife } from "../life/state";
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
