import { describe, expect, it } from "vitest";
import { catalog } from "@cg/shared";
import { searchCatalog } from "./filterCatalog";

const items = [...catalog.furniture.values(), ...catalog.openings.values()];
const ids = (query: string) => searchCatalog(items, query).map((item) => item.id);

describe("catalog search", () => {
  it("finds kitchen and bathroom sinks together", () => {
    expect(ids("sink")).toEqual(expect.arrayContaining(["counter_sink", "bath_sink"]));
  });
  it("finds openings alongside furniture", () => {
    expect(searchCatalog(items, "window")).toHaveLength(3);
    expect(searchCatalog(items, "window").every((item) => "kind" in item && item.kind === "window")).toBe(true);
    expect(searchCatalog(items, "door").every((item) => "kind" in item && item.kind === "door")).toBe(true);
    expect(searchCatalog(items, "sofa").every((item) => "footprint" in item)).toBe(true);
  });
  it("ignores case and extra whitespace and accepts words in any order", () => {
    expect(ids("  SOFA   cozy  ")).toEqual(["sofa_cozy"]);
    expect(ids("cozy sofa")).toEqual(ids("sofa cozy"));
  });
  it("searches category names and requires every word", () => {
    expect(ids("bathroom sink")).toEqual(["bath_sink"]);
    expect(ids("bathroom sofa")).toEqual([]);
  });
  it("clears back to the entire collection without changing its order", () => {
    expect(searchCatalog(items, "  ")).toEqual(items);
    expect(items.length).toBe(35);
  });
  it("handles punctuation and unknown queries as text", () => {
    expect(ids("[nothing.*")).toEqual([]);
  });
});
