import { z } from "zod";
import furnitureData from "./furniture.json";
import piecesData from "./pieces.json";
import recipesData from "./recipes.json";

/**
 * Everything players can build with lives in JSON next to this file. It is checked once when loaded, so a typo
 * in the data fails fast instead of surfacing as a strange bug mid-game. The client draws each item from its
 * `model` description (a model kind plus colours and options); new items need no code unless they need a new kind.
 */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

const FurnitureItem = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["living", "bedroom", "kitchen", "bathroom", "decor"]),
  price: z.number().int().nonnegative(),
  footprint: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]),
  /** Floor items can't overlap each other; rugs go underneath them. */
  layer: z.enum(["floor", "rug"]),
  model: z.looseObject({ kind: z.string() }),
});

const Finish = z.enum(["plaster", "wood", "stone", "brick", "checker", "setts", "concrete", "carpet"]);

const WallStyle = z.object({ id: z.string(), name: z.string(), color: hex, finish: Finish });
const FloorMaterial = z.object({ id: z.string(), name: z.string(), color: hex, finish: Finish });

const Recipe = z.object({
  id: z.string(),
  name: z.string(),
  serves: z.number().int().positive(),
  ingredients: z.array(z.string()),
  steps: z.array(z.object({ station: z.string(), action: z.string(), seconds: z.number().positive() })),
});

export type FurnitureItem = z.infer<typeof FurnitureItem>;
export type WallStyle = z.infer<typeof WallStyle>;
export type FloorMaterial = z.infer<typeof FloorMaterial>;
export type Recipe = z.infer<typeof Recipe>;
export type Finish = z.infer<typeof Finish>;

export interface Catalog {
  furniture: Map<string, FurnitureItem>;
  wallStyles: Map<string, WallStyle>;
  floorMaterials: Map<string, FloorMaterial>;
  recipes: Map<string, Recipe>;
}

function byId<T extends { id: string }>(items: T[], what: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) {
    if (m.has(it.id)) throw new Error(`Duplicate ${what} id "${it.id}"`);
    m.set(it.id, it);
  }
  return m;
}

export function loadCatalog(raw: { furniture: unknown; pieces: unknown; recipes: unknown }): Catalog {
  const pieces = z.object({ wallStyles: z.array(WallStyle), floorMaterials: z.array(FloorMaterial) }).parse(raw.pieces);
  return {
    furniture: byId(z.array(FurnitureItem).parse(raw.furniture), "furniture"),
    wallStyles: byId(pieces.wallStyles, "wall style"),
    floorMaterials: byId(pieces.floorMaterials, "floor material"),
    recipes: byId(z.array(Recipe).parse(raw.recipes), "recipe"),
  };
}

export const catalog: Catalog = loadCatalog({ furniture: furnitureData, pieces: piecesData, recipes: recipesData });
