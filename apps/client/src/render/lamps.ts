import { catalog, footprintOf, STOREY, type Blueprint } from "@cg/shared";

/**
 * The house's lamps, for the night: each lights a warm pool round it (see `lighting.lamps` in pencil.ts). Which kinds
 * of furniture are lamps, how high their light sits and how far it reaches are here; everything else about them
 * (the shade glowing) is in their models.
 */
export interface Lamp {
  id: string;
  x: number;
  y: number;
  z: number;
  /** How far the light reaches, metres. */
  r: number;
}

const KINDS: Record<string, { y: number; r: number }> = {
  lamp: { y: 1.45, r: 4.6 },
  arclamp: { y: 2.05, r: 5.2 },
  readinglamp: { y: 1.4, r: 4.2 },
  desk: { y: 0.95, r: 2.6 },
};

/** Every lamp in the house, on every floor. */
export function lampSpots(bp: Blueprint): Lamp[] {
  const out: Lamp[] = [];
  bp.levels.forEach((level, i) => {
    for (const o of Object.values(level.objects)) {
      const item = catalog.furniture.get(o.catalogId);
      const k = item && KINDS[item.model.kind];
      // (a desk only counts if it came with a lamp)
      if (!item || !k || (item.model.kind === "desk" && !item.model.lamp)) continue;
      const f = footprintOf(item, o);
      out.push({ id: o.id, x: f.x + f.w / 2, y: i * STOREY + k.y, z: f.z + f.d / 2, r: k.r });
    }
  });
  return out;
}
