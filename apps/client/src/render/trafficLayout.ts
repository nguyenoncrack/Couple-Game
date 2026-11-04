import { LANE, STREET_REACH, streetZ } from "./sceneryLayout";

/**
 * Cars along the street out front (see Traffic). Each lane sends a car off from one end every few seconds, or
 * more often doesn't, so they come by at odd moments; every car in a lane keeps the same speed, so none ever
 * catches up with the one ahead. The street runs out into the haze both ways, so they appear and vanish
 * unseen. Worked out from the time alone: cosmetic, on each screen's own clock.
 */

export type CarModel = "hatch" | "van" | "pickup";

export interface Lane {
  /** +1 heading toward +x, -1 toward -x. */
  dir: 1 | -1;
  z: number;
  /** Metres a second. */
  speed: number;
  /** One car per slot; a slot sees its car off the far end before it's needed again. */
  cars: { model: CarModel; tone: string }[];
}

/** A chance to set off every this many seconds, and how often one does. */
export const TICK = 5;
export const BUSY = 0.22;

const MODELS: CarModel[] = ["hatch", "hatch", "van", "pickup"];
const TONES = ["#c9493c", "#4f7fb0", "#e8c25a", "#f4efe4", "#5f8f5a", "#8a6aa8", "#3f4a4f", "#e08a4a"];

/** A number from 0 to 1 that's always the same for the same three. */
const hash = (a: number, b: number, c = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

export function lanes(d: number): Lane[] {
  return ([[1, 10], [-1, 9]] as const).map(([dir, speed], l) => {
    const slots = Math.ceil((STREET_REACH * 2) / speed / TICK) + 2;
    return {
      dir,
      // keeping to the right: +x traffic on the far side of the middle line
      z: streetZ(d) + dir * LANE,
      speed,
      cars: Array.from({ length: slots }, (_, s) => ({ model: MODELS[Math.floor(hash(l, s, 1) * MODELS.length)]!, tone: TONES[Math.floor(hash(l, s, 2) * TONES.length)]! })),
    };
  });
}

/** Where slot `s` of lane `l`'s car is at `t` seconds (x, from the lot's middle), or null while it's off the street. */
export function carAt(lane: Lane, l: number, s: number, t: number): number | null {
  const n = lane.cars.length;
  const travel = (STREET_REACH * 2) / lane.speed;
  // the last tick this slot had: ticks take turns round the slots
  let j = s + n * Math.floor((t / TICK - s) / n);
  let depart = j * TICK + hash(l, j, 3) * TICK * 0.4;
  if (depart > t) {
    j -= n;
    depart = j * TICK + hash(l, j, 3) * TICK * 0.4;
  }
  const age = t - depart;
  if (age > travel || hash(l, j) >= BUSY) return null;
  return lane.dir * (-STREET_REACH + age * lane.speed);
}
