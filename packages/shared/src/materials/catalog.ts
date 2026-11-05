import { z } from "zod";
import data from "./materials.json";

/** Render-only metadata. Homes continue saving their existing wall style / floor material IDs. */
export const BuildSurface = z.enum(["plaster", "panels", "brick", "stone", "tile", "concrete", "glass", "oak", "walnut", "parquet", "marble", "carpet", "decking", "pavers"]);
export type BuildSurface = z.infer<typeof BuildSurface>;
export const surfaceMetadata = {
  surface: BuildSurface.optional(),
  description: z.string().max(160).optional(),
};

/** Preserve legacy IDs and custom catalog loading; extend only the default building catalog. */
export function withBuildMaterials<T extends { wallStyles: { id: string }[]; floorMaterials: { id: string }[] }>(pieces: T) {
  const merge = (a: { id: string }[], b: { id: string }[]) => [...new Map([...a, ...b].map((v) => [v.id, v])).values()];
  return { ...pieces, wallStyles: merge(pieces.wallStyles, data.wallStyles), floorMaterials: merge(pieces.floorMaterials, data.floorMaterials) };
}
