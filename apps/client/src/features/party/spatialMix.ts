import { catalog, rotatedSize, STOREY, type Blueprint } from "@cg/shared";

/**
 * The music comes from the house's speakers (and the DJ booth and music player), and gets quieter the further you
 * stand from them. YouTube's player only lets us set its volume, so this works out one number between 0 and 1 for
 * where this player's character is; it scales the volume they chose. (It can't pan left and right: the sound is
 * the video's own, and that's the player's to keep.)
 */

/** Where sound comes from: the middle of the item, in lot metres, and the floor it's on. */
export interface Source {
  x: number;
  z: number;
  level: number;
  /** Speakers are loudest; a booth or player on its own is a little quieter. */
  loud: number;
}

/** Full volume within this many metres of a source. */
export const NEAR = 2;
/** Never quite silent in the same house: the party can still be heard from the far end. */
export const FLOOR = 0.05;
/** Walls and floors in between muffle it: each floor up or down counts as this many metres more. */
export const STOREY_AS_METRES = 7;

const LOUD: Record<string, number> = { speaker: 1, music: 0.8 };

/** Every speaker, booth and player in the house. */
export function musicSources(bp: Blueprint): Source[] {
  const out: Source[] = [];
  bp.levels.forEach((level, index) => {
    for (const o of Object.values(level.objects)) {
      const item = catalog.furniture.get(o.catalogId);
      const loud = Math.max(0, ...(item?.party ?? []).map((r) => LOUD[r] ?? 0));
      if (!item || !loud) continue;
      const [w, d] = rotatedSize(item.footprint[0], item.footprint[1], o.rot);
      out.push({ x: o.x + w / 2, z: o.z + d / 2, level: index, loud });
    }
  });
  return out;
}

/** How loud one source is `metres` away: full up close, then falling off steadily (about a third at 6 m). */
export const falloff = (metres: number) => (metres <= NEAR ? 1 : Math.max(FLOOR, (NEAR / metres) ** 1.3));

/** 0..1: the loudest any source is for someone at (x, z) on `level`. With no sources there's nothing to fade from. */
export function musicGain(sources: Source[], x: number, z: number, level: number): number {
  if (!sources.length) return 1;
  let best = 0;
  for (const s of sources) {
    const metres = Math.hypot(s.x - x, s.z - z) + Math.abs(s.level - level) * STOREY_AS_METRES;
    best = Math.max(best, falloff(metres) * s.loud);
  }
  return Math.min(1, best);
}

/** The floor a height (metres) is on. */
export const levelAtHeight = (y: number) => Math.max(0, Math.round(y / STOREY));

/** Step `gain` towards `target`, so walking about changes the sound smoothly rather than in jumps. */
export const easeGain = (gain: number, target: number, k = 0.35) => (Math.abs(target - gain) < 0.01 ? target : gain + (target - gain) * k);
