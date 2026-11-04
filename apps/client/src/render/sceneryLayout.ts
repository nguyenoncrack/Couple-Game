type V3 = [number, number, number];

/** The lake: an irregular oval behind the house. */
export function lakeShape(w: number) {
  const cx = w * 0.35;
  const cz = -26;
  const rx = 26;
  const rz = 13;
  /** The shore's distance from the middle at an angle, as a fraction of the radii. */
  const reach = (a: number) => 1 + 0.12 * Math.sin(3 * a + 1) + 0.07 * Math.sin(5 * a + 2) + 0.05 * Math.sin(8 * a);
  /** How far inside the shore a point is: < 1 in the water, with `margin` metres of extra room. */
  const inside = (x: number, z: number, margin = 0) => {
    const u = (x - cx) / rx;
    const v = (z - cz) / rz;
    return Math.hypot(u, v) < reach(Math.atan2(v, u)) + margin / rz;
  };
  return { cx, cz, rx, rz, reach, inside };
}

/** Where the campsite's pieces sit, beside the lot on the x < 0 side. */
export function campLayout(d: number) {
  const cabin = { x: -11, z: Math.max(5, d / 2 - 4) };
  const fire: V3 = [-4.5, 0, Math.min(12.5, d - 4)];
  // the trail: in from the pavement out front to the fire circle, then on from its far side to the cabin porch
  const toFire: [number, number][] = [
    [-3.2, d + 1.8],
    [-3.0, d - 0.5],
    [-3.4, d - 2.6],
    [fire[0] + 0.4, fire[2] + 3.1],
  ];
  const toCabin: [number, number][] = [
    [fire[0] - 2.3, fire[2] - 2.3],
    [cabin.x + 4.2, cabin.z + 2.6],
    [cabin.x + 3.8, cabin.z + 0.8],
    [cabin.x + 3.4, cabin.z - 0.6],
  ];
  return { cabin, fire, trails: [toFire, toCabin] };
}


/** Where the playground's pieces sit, beside the lot on the x > w side. */
export function playLayout(w: number, d: number) {
  const cx = w + 5;
  const cz = d / 2 + 0.5;
  return {
    cx,
    cz,
    /** The swings hang from the frame's top bar, this high, each rocking `sin(t·SWING_RATE + phase)·SWING_ARC`. */
    swings: [-0.6, 0.6].map((dz, i) => ({ x: cx + 1.6, y: 2.3, z: cz + dz, phase: i * 2.1 })),
    /** The slide's platform (its ladder runs up from -z, its chute down toward +z). */
    slide: { x: cx - 1.7, z: cz + 1.6 },
    sandbox: { x: cx - 1.6, z: cz - 1.9 },
  };
}
export const SWING_RATE = 1.7;
export const SWING_ARC = 0.16;
/** From the top bar down to the seat. */
export const SWING_DROP = 1.78;
