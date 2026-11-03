import { describe, expect, it } from "vitest";
import { AppearanceSchema, DEFAULT_APPEARANCE, HAIRSTYLES, SKIN_TONES, OUTFITS, changeGender, normalizeAppearance } from "../appearance";

describe("cosmetic appearance data", () => {
  it("offers six unique hairstyles for each style group", () => {
    for (const choices of Object.values(HAIRSTYLES)) {
      expect(choices).toHaveLength(6);
      expect(new Set(choices.map((x) => x.id)).size).toBe(6);
    }
  });
  it("validates every hairstyle, skin tone and outfit combination", () => {
    for (const gender of ["guy", "girl"] as const) for (const hair of HAIRSTYLES[gender]) for (const skin of SKIN_TONES) for (const outfit of OUTFITS) {
      expect(AppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, gender, hairstyle: hair.id, skinTone: skin.id, outfit: outfit.id }).success).toBe(true);
    }
  });
  it("rejects unknown options and gameplay fields", () => {
    expect(AppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, skinTone: "anything" }).success).toBe(false);
    expect(AppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, speed: 99 }).success).toBe(false);
    expect(AppearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, gender: "girl", hairstyle: "quiff" }).success).toBe(false);
  });
  it("recovers invalid stored data without retaining unrelated fields", () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ speed: 99, gender: "girl", hairstyle: "quiff" })).toEqual({ ...DEFAULT_APPEARANCE, gender: "girl", hairstyle: "bob" });
  });
  it("keeps clothing and colors when changing style groups", () => {
    const value = { ...DEFAULT_APPEARANCE, outfit: "skirt" as const, skinTone: "ebony" as const };
    const changed = changeGender(value, "girl");
    expect(changed).toMatchObject({ gender: "girl", hairstyle: "bob", outfit: "skirt", skinTone: "ebony" });
    expect(value.gender).toBe("guy");
  });
});
