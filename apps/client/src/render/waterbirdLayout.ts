import { lakeShape } from "./sceneryLayout";

export const WATERBIRDS = 5;
/** A family follows a small loop in open water. The conservative radii keep the entire route off the bank,
 * reeds, lilies, dock and boat for every supported lot width. Cosmetic time never enters shared house state. */
export function waterbirdPose(w: number, index: number, seconds: number) {
  const lake = lakeShape(w);
  const a = seconds * 0.045 - index * 0.15;
  const rx = 4.6 + (index % 2) * 0.18, rz = 1.4 + (index % 2) * 0.12;
  const x = lake.cx - 5 + Math.cos(a) * rx;
  const z = lake.cz + 5 + Math.sin(a) * rz;
  return { x, z, y: 0.045 + Math.sin(seconds * 2.1 + index) * 0.008, turn: Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz), scale: index < 2 ? 1 : 0.48 };
}
