import { HIP } from "../../features/character/characterParts";
import type { Pose } from "../Characters";

/**
 * Dancing and working the decks, as poses over time. Each dance is a loop (all of them repeat cleanly, none
 * flashes: the quickest is under two beats a second).
 */

const TAU = Math.PI * 2;
/** Eases 0 to 1 and back with a smooth sine. */
const swing = (s: number, hz: number, phase = 0) => 0.5 + 0.5 * Math.sin((s * hz + phase) * TAU);

export function groovePose(move: string | undefined, s: number): Pose {
  switch (move) {
    case "sway": {
      const w = Math.sin(s * TAU * 0.5);
      return { hip: HIP - 0.012, lean: 0.02, thighs: [-0.08 + w * 0.08, -0.08 - w * 0.08], knees: [0.14, 0.14], arms: [-0.55 + w * 0.5, -0.55 - w * 0.5], spread: 0.75, roll: 0, twist: w * 0.32 };
    }
    case "disco": {
      // a point to the ceiling and a point to the floor, switching sides, with a little knee dip on the beat
      const a = Math.sin(s * TAU * 0.5);
      const k = swing(s, 1.0);
      return { hip: HIP - 0.04 * k, lean: 0.03, thighs: [-0.2 * k, -0.2 * k], knees: [0.4 * k, 0.4 * k], arms: [a > 0 ? -2.75 + 0.1 * Math.sin(s * TAU * 2) : -0.25, a > 0 ? -0.25 : -2.75 + 0.1 * Math.sin(s * TAU * 2)], spread: 0.35, roll: 0, twist: a * 0.35 };
    }
    case "hands-up": {
      const k = swing(s, 1.0);
      const w = Math.sin(s * TAU * 1.0);
      return { hip: HIP - 0.05 * k, lean: -0.04, thighs: [-0.3 * k, -0.3 * k], knees: [0.55 * k, 0.55 * k], arms: [-2.85 + w * 0.18, -2.85 - w * 0.18], spread: 0.55, roll: 0, twist: w * 0.12 };
    }
    case "shuffle": {
      const w = Math.sin(s * TAU * 1.2);
      return { hip: HIP - 0.02 + Math.abs(w) * 0.02, lean: 0.1, thighs: [w * 0.55, -w * 0.55], knees: [Math.max(0, -w) * 0.7, Math.max(0, w) * 0.7], arms: [-0.9 - w * 0.6, -0.9 + w * 0.6], spread: 0.3, roll: 0, twist: w * 0.22 };
    }
    default: {
      // bounce
      const k = swing(s, 0.9);
      const w = Math.sin(s * TAU * 0.9);
      return { hip: HIP - 0.06 * k, lean: 0.05, thighs: [-0.3 * k, -0.3 * k], knees: [0.6 * k, 0.6 * k], arms: [-0.95 + w * 0.55, -0.95 - w * 0.55], spread: 0.2, roll: 0, twist: w * 0.14 };
    }
  }
}

/** Behind the decks: bent over a little, one hand on the mixer, the other scratching, nodding to the beat. */
export function djPose(s: number): Pose {
  const nod = Math.sin(s * TAU * 0.9);
  return { hip: HIP + nod * 0.008, lean: -0.14 + nod * 0.03, thighs: [0, 0], knees: [0.02, 0.02], arms: [-1.15, -0.95 + Math.sin(s * TAU * 1.6) * 0.22], spread: 0.18, roll: 0, twist: Math.sin(s * TAU * 0.45) * 0.12 };
}
