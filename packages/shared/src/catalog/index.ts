import { z } from "zod";
import { surfaceMetadata, withBuildMaterials } from "../materials/catalog";
import furnitureData from "./furniture.json";
import openingsData from "./openings.json";
import piecesData from "./pieces.json";
import recipesData from "./recipes.json";

/**
 * Everything players can build with lives in JSON next to this file. It is checked once when loaded, so a typo
 * in the data fails fast instead of surfacing as a strange bug mid-game. The client draws each item from its
 * `model` description (a model kind plus colours and options); new items need no code unless they need a new kind.
 */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * Things a character can do with a piece of furniture. Station actions are where recipe steps happen. Watching
 * is done from a seat facing a TV (or the floor in front of it, if there's none).
 */
export const ACTIONS = ["sit", "sleep", "lounge", "cook", "prep", "watch", "play", "pingpong", "blackjack", "swim", "bathe", "toilet", "wash"] as const;
export const STATIONS = ["stove", "counter"] as const;

/**
 * One place to use a piece of furniture (a seat, one side of a bed), in the item's own unrotated frame: x across
 * its width, z across its depth, facing +z. The character walks to the first free `stand` cell (relative to the
 * footprint's corner, may lie outside it), then settles at `pose` (metres from the corner) at height `y`, facing
 * `face` quarter turns from +z.
 */
const Slot = z.object({
  stand: z.array(z.tuple([z.number().int().min(-2).max(8), z.number().int().min(-2).max(8)])).min(1),
  pose: z.tuple([z.number(), z.number()]),
  y: z.number().min(0).max(2),
  face: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

/** `seconds`: a quick thing (washing your hands) that's over after that long, rather than lasting until you get up. */
const Interaction = z
  .object({
    action: z.enum(ACTIONS),
    station: z.enum(STATIONS).optional(),
    seconds: z.number().positive().max(120).optional(),
    slots: z.array(Slot).min(1).max(6),
  })
  .refine((i) => (i.action === "cook" || i.action === "prep") === Boolean(i.station), "cook and prep need a station; nothing else has one");

const FurnitureItem = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["living", "bedroom", "kitchen", "bathroom", "decor", "outdoor", "entertainment"]),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  price: z.number().int().nonnegative(),
  footprint: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]),
  /** Floor items can't overlap each other; rugs go underneath them. */
  layer: z.enum(["floor", "rug"]),
  /** Finished dishes are served on surfaces. */
  surface: z.boolean().optional(),
  /** Climbs a whole storey along its length, to the floor above (see stairs.ts). */
  stairs: z.boolean().optional(),
  /** A lift: its shaft goes up through every floor above (see lifts.ts). */
  lift: z.boolean().optional(),
  /** Leftovers are kept in it (one store for the house, whichever fridge you open). */
  fridge: z.boolean().optional(),
  model: z.looseObject({ kind: z.string() }),
  interactions: z.array(Interaction).optional(),
});

/** Doors and windows sit in walls: `width` unit wall edges, open from `sill` to `top` metres. */
const OpeningItem = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["door", "window"]),
    price: z.number().int().nonnegative(),
    width: z.number().int().min(1).max(4),
    sill: z.number().min(0).max(2),
    top: z.number().min(0.5).max(2.6),
    model: z.looseObject({ kind: z.string() }),
  })
  .refine((o) => o.top > o.sill + 0.3, "an opening needs some height");

const Finish = z.enum(["plaster", "wood", "stone", "brick", "checker", "setts", "concrete", "carpet", "shingle"]);

const WallStyle = z.object({ id: z.string(), name: z.string(), color: hex, finish: Finish, ...surfaceMetadata });
const FloorMaterial = z.object({ id: z.string(), name: z.string(), color: hex, finish: Finish, ...surfaceMetadata });
/** `ceiling` is the colour of the roof's underside, seen from inside. */
const RoofStyle = z.object({ id: z.string(), name: z.string(), color: hex, finish: Finish, ceiling: hex });

const Recipe = z.object({
  id: z.string(),
  name: z.string(),
  serves: z.number().int().positive(),
  ingredients: z.array(z.string()),
  steps: z.array(z.object({ station: z.enum(STATIONS), action: z.string(), seconds: z.number().positive() })).min(1),
});

export type FurnitureItem = z.infer<typeof FurnitureItem>;
export type Interaction = z.infer<typeof Interaction>;
export type InteractionSlot = z.infer<typeof Slot>;
export type Action = (typeof ACTIONS)[number];
export type Station = (typeof STATIONS)[number];
export type OpeningItem = z.infer<typeof OpeningItem>;
export type WallStyle = z.infer<typeof WallStyle>;
export type FloorMaterial = z.infer<typeof FloorMaterial>;
export type RoofStyle = z.infer<typeof RoofStyle>;
export type Recipe = z.infer<typeof Recipe>;
export type Finish = z.infer<typeof Finish>;

export interface Catalog {
  furniture: Map<string, FurnitureItem>;
  openings: Map<string, OpeningItem>;
  wallStyles: Map<string, WallStyle>;
  floorMaterials: Map<string, FloorMaterial>;
  roofStyles: Map<string, RoofStyle>;
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

export function loadCatalog(raw: { furniture: unknown; openings: unknown; pieces: unknown; recipes: unknown }): Catalog {
  const pieces = z.object({ wallStyles: z.array(WallStyle), floorMaterials: z.array(FloorMaterial), roofStyles: z.array(RoofStyle) }).parse(raw.pieces);
  return {
    furniture: byId(z.array(FurnitureItem).parse(raw.furniture), "furniture"),
    openings: byId(z.array(OpeningItem).parse(raw.openings), "opening"),
    wallStyles: byId(pieces.wallStyles, "wall style"),
    floorMaterials: byId(pieces.floorMaterials, "floor material"),
    roofStyles: byId(pieces.roofStyles, "roof style"),
    recipes: byId(z.array(Recipe).parse(raw.recipes), "recipe"),
  };
}

export const catalog: Catalog = loadCatalog({ furniture: furnitureData, openings: openingsData, pieces: withBuildMaterials(piecesData), recipes: recipesData });
