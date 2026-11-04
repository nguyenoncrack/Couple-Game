import type { Level } from "@cg/shared";
import { meadowClearance, type Sprig } from "./meadowLayout";
import { shoreLayout } from "./shoreLayout";
import { woodsLayout } from "./woodsLayout";

export const MAX_COVER = 12000;
export const MAX_LITTER = 1400;

/** Stable cosmetic candidates. Editing a house only filters plants; it never moves the surviving ones. */
export function groundcoverLayout(w: number, d: number, level: Level) {
  let seed = 918432;
  const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const clear = meadowClearance(w, d, level);
  const grass: Sprig[] = [], litter: Sprig[] = [];
  const shore = shoreLayout(w, d);
  for (let i = 0; i < MAX_COVER / 20; i++) {
    const [x, z] = i < 480
      ? [w / 2 + (r() - 0.5) * (w + 78), d / 2 + (r() - 0.5) * (d + 80)]
      : shore.edge(r() * Math.PI * 2, 3 + r() * 2.2);
    const radius = 0.8 + r() * 2.4;
    for (let j = 0; j < 20; j++) {
      const a = r() * Math.PI * 2, dist = Math.sqrt(r()) * radius;
      const sprig = { x: x + Math.cos(a) * dist, z: z + Math.sin(a) * dist, scale: 0.55 + r() * 0.8, turn: r() * 6.283, kind: i % 3 };
      // Keep the buildable lawn tidy and preserve all existing path/room/prop clearances.
      const inLot = sprig.x >= 0 && sprig.x <= w && sprig.z >= 0 && sprig.z <= d;
      if (!inLot && Math.hypot(sprig.x - w / 2, sprig.z - d / 2) < 58 && clear(sprig.x, sprig.z)) grass.push(sprig);
    }
  }
  for (const tree of woodsLayout(w, d).trees) {
    if (tree.kind === "fir" || tree.kind === "spire" || Math.hypot(tree.x - w / 2, tree.z - d / 2) > 48) continue;
    for (let i = 0; i < 26 && litter.length < MAX_LITTER; i++) {
      const a = r() * 6.283, dist = Math.sqrt(r()) * 1.8 * tree.s;
      const sprig = { x: tree.x + Math.cos(a) * dist, z: tree.z + Math.sin(a) * dist, scale: 0.65 + r() * 0.7, turn: r() * 6.283, kind: i % 3 };
      if (clear(sprig.x, sprig.z)) litter.push(sprig);
    }
  }
  return { grass, litter };
}
