import { z } from "zod";

/** Cosmetic data only. These values are never movement, collision, economy or interaction inputs. */
export const HAIRSTYLES = {
  guy: [
    { id: "buzz", name: "Buzz cut" }, { id: "side-part", name: "Side part" },
    { id: "quiff", name: "Soft quiff" }, { id: "curls", name: "Curly crop" },
    { id: "curtains", name: "Curtains" }, { id: "top-knot", name: "Top knot" },
  ],
  girl: [
    { id: "bob", name: "Chin-length bob" }, { id: "long", name: "Long & straight" },
    { id: "ponytail", name: "Ponytail" }, { id: "braid", name: "Loose braid" },
    { id: "space-buns", name: "Double buns" }, { id: "waves", name: "Soft waves" },
  ],
} as const;
export type Gender = keyof typeof HAIRSTYLES;
export type Hairstyle = (typeof HAIRSTYLES)[Gender][number]["id"];
export const SKIN_TONES = [
  { id: "porcelain", name: "Porcelain", color: "#f6d9c4" },
  { id: "ivory", name: "Warm ivory", color: "#edc5a4" },
  { id: "sand", name: "Sand", color: "#dcb08a" },
  { id: "honey", name: "Honey", color: "#c99362" },
  { id: "caramel", name: "Caramel", color: "#b17a50" },
  { id: "chestnut", name: "Chestnut", color: "#915e43" },
  { id: "umber", name: "Umber", color: "#704633" },
  { id: "ebony", name: "Deep ebony", color: "#4c3029" },
] as const;
export const HAIR_COLORS = [
  { id: "espresso", name: "Espresso", color: "#342b28" },
  { id: "chocolate", name: "Chocolate", color: "#624333" },
  { id: "auburn", name: "Auburn", color: "#a15e40" },
  { id: "golden", name: "Golden blonde", color: "#d6b66c" },
  { id: "silver", name: "Silver", color: "#c2bfb6" },
  { id: "rose", name: "Dusty rose", color: "#b47e83" },
] as const;
export const CLOTHING_COLORS = [
  { id: "coral", name: "Terracotta", color: "#cf7d62" },
  { id: "sage", name: "Sage", color: "#91a383" },
  { id: "blue", name: "Dusty blue", color: "#7296ab" },
  { id: "cream", name: "Oat milk", color: "#eee4ca" },
  { id: "mustard", name: "Marigold", color: "#d4b55b" },
  { id: "charcoal", name: "Charcoal", color: "#50565a" },
] as const;
export const OUTFITS = [
  { id: "long-pants", name: "Long pants" }, { id: "shorts", name: "Shorts" }, { id: "skirt", name: "Skirt" },
] as const;
export interface Appearance {
  version: 1;
  gender: Gender;
  hairstyle: Hairstyle;
  skinTone: (typeof SKIN_TONES)[number]["id"];
  hairColor: (typeof HAIR_COLORS)[number]["id"];
  shirtColor: (typeof CLOTHING_COLORS)[number]["id"];
  bottomColor: (typeof CLOTHING_COLORS)[number]["id"];
  outfit: (typeof OUTFITS)[number]["id"];
}
export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
  version: 1, gender: "guy", hairstyle: "side-part", skinTone: "sand", hairColor: "chocolate",
  shirtColor: "sage", bottomColor: "charcoal", outfit: "long-pants",
};
function choice<T extends string>(value: unknown, choices: readonly { id: T }[], fallback: T): T {
  return choices.some((c) => c.id === value) ? value as T : fallback;
}
/** Accept known cosmetic IDs only; strip unrelated fields and recover from older/invalid saves. */
export function normalizeAppearance(value: unknown): Appearance {
  const p = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const gender: Gender = p.gender === "girl" ? "girl" : "guy";
  return {
    version: 1, gender,
    hairstyle: choice(p.hairstyle, HAIRSTYLES[gender], gender === "guy" ? "side-part" : "bob"),
    skinTone: choice(p.skinTone, SKIN_TONES, DEFAULT_APPEARANCE.skinTone),
    hairColor: choice(p.hairColor, HAIR_COLORS, DEFAULT_APPEARANCE.hairColor),
    shirtColor: choice(p.shirtColor, CLOTHING_COLORS, DEFAULT_APPEARANCE.shirtColor),
    bottomColor: choice(p.bottomColor, CLOTHING_COLORS, DEFAULT_APPEARANCE.bottomColor),
    outfit: choice(p.outfit, OUTFITS, DEFAULT_APPEARANCE.outfit),
  };
}
export function changeGender(value: Appearance, gender: Gender): Appearance {
  return normalizeAppearance({ ...value, gender, hairstyle: HAIRSTYLES[gender][0].id });
}
export function appearanceColors(value: Appearance) {
  return {
    skin: SKIN_TONES.find((v) => v.id === value.skinTone)!.color,
    hair: HAIR_COLORS.find((v) => v.id === value.hairColor)!.color,
    shirt: CLOTHING_COLORS.find((v) => v.id === value.shirtColor)!.color,
    bottom: CLOTHING_COLORS.find((v) => v.id === value.bottomColor)!.color,
  };
}

/** Strict API boundary: appearance payloads cannot carry gameplay or account fields. */
export const AppearanceSchema = z.object({
  version: z.literal(1), gender: z.enum(["guy", "girl"]),
  hairstyle: z.enum(["buzz", "side-part", "quiff", "curls", "curtains", "top-knot", "bob", "long", "ponytail", "braid", "space-buns", "waves"]),
  skinTone: z.enum(["porcelain", "ivory", "sand", "honey", "caramel", "chestnut", "umber", "ebony"]),
  hairColor: z.enum(["espresso", "chocolate", "auburn", "golden", "silver", "rose"]),
  shirtColor: z.enum(["coral", "sage", "blue", "cream", "mustard", "charcoal"]),
  bottomColor: z.enum(["coral", "sage", "blue", "cream", "mustard", "charcoal"]),
  outfit: z.enum(["long-pants", "shorts", "skirt"]),
}).strict().refine((a) => HAIRSTYLES[a.gender].some((h) => h.id === a.hairstyle), "Choose a hairstyle from the selected style group");
