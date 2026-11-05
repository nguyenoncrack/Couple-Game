import { describe, expect, it } from "vitest";
import { catalog } from "@cg/shared";
import { searchCatalog } from "./filterCatalog";
import { colorsOf, familyOf, groupVariants } from "./VariantSwatches";

const furniture = [...catalog.furniture.values()];

describe("catalog colours", () => {
  it("shows each item once per tab, its colours with it", () => {
    const kitchen = groupVariants(furniture.filter((i) => i.category === "kitchen"));
    const chairs = kitchen.find((g) => familyOf(g[0]!) === "dining_chair")!;
    expect(chairs.map((i) => i.id)).toEqual(["dining_chair", "dining_chair_white", "dining_chair_walnut"]);
    // in the order the items came, each family where its first one was
    expect(kitchen.map((g) => g[0]!.id).slice(0, 3)).toEqual(["dining_table", "dining_chair", "counter"]);
    expect(new Set(kitchen.flat()).size).toBe(furniture.filter((i) => i.category === "kitchen").length);
  });

  it("finds a colour by name and shows it on its item's card", () => {
    const found = groupVariants(searchCatalog(furniture, "walnut"));
    expect(found.length).toBeGreaterThan(5);
    for (const g of found) expect(g[0]!.name.toLowerCase()).toContain("walnut");
    expect(found.map((g) => familyOf(g[0]!))).toContain("bed_double");
  });

  it("has swatches only for items that come in more than one colour", () => {
    expect(colorsOf("dining_chair_walnut").map((i) => i.id)).toEqual(["dining_chair", "dining_chair_white", "dining_chair_walnut"]);
    expect(colorsOf("car_hatch")).toEqual([]);
    expect(colorsOf("door_wood")).toEqual([]);
  });
});
