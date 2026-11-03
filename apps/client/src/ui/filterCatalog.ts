import type { FurnitureItem, OpeningItem } from "@cg/shared";

export type CatalogEntry = FurnitureItem | OpeningItem;

/** Search across categories; every word must match, in any order. */
export function searchCatalog(items: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const category = "category" in item ? item.category : `${item.kind === "window" ? "windows" : "doors"} openings`;
    const tokens = `${item.name} ${category} ${item.model.kind} ${item.id}`.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return words.every((word) => tokens.some((token) => token.startsWith(word)));
  });
}
