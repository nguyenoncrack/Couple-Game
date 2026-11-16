import { sunHeight } from "@cg/shared";

/**
 * The sky for a moment of the day (`phase`: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight), as plain numbers: where
 * the light comes from, what colour it is, and the haze beyond the lot. Colours are RGB in the shader's linear light
 * (fog is an sRGB hex, as the page draws it). Everything moves smoothly through the day, so nothing ever pops.
 *
 * Night is for the moon: it rises as the sun sets, on the same side, and lights the lot cool and low. The direction is
 * never allowed lower than `MIN_LIGHT_Y`, so the shadows stay a sensible length at dawn and dusk instead of
 * stretching to infinity; the light fades out well before that matters.
 */

export type RGB = [number, number, number];
export interface Sky {
  /** The sun's height: 1 at noon, 0 at the horizon, -1 at midnight. */
  height: number;
  /** 0 in full night, 1 in full day (a smooth step across dawn and dusk). */
  day: number;
  /** 1 once it's dark enough for lamps and windows to glow; 0 in daylight. */
  night: number;
  /** The golden hour: 1 when the sun sits low in the sky, either end of the day. */
  gold: number;
  /** A unit vector pointing at whatever lights the lot (the sun by day, the moon by night). */
  lightDir: [number, number, number];
  /** The colour of that light (already weighted by how strong it is), and the sky's and the ground's fill. */
  sun: RGB;
  sky: RGB;
  bounce: RGB;
  /** The colour of the air at the horizon, and so of the page beyond everything; and of the sky overhead. */
  fog: string;
  zenith: string;
  /** The sun's own place in the sky (for drawing it): same unit space, may be below the horizon. */
  sunDir: [number, number, number];
  moonDir: [number, number, number];
}

export const MIN_LIGHT_Y = 0.2;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mixHex = (a: string, b: string, t: number) => rgbToHex(mix3(hexToRgb(a), hexToRgb(b), t));

const DAY = { sun: [1.0, 0.86, 0.68] as RGB, sky: [0.6, 0.64, 0.72] as RGB, bounce: [0.46, 0.42, 0.37] as RGB, fog: "#e9ede4", zenith: "#7fb1df" };
const GOLD = { sun: [1.0, 0.5, 0.24] as RGB, sky: [0.72, 0.58, 0.6] as RGB, bounce: [0.5, 0.38, 0.32] as RGB, fog: "#f1cfb2", zenith: "#8d96c6" };
const NIGHT = { sun: [0.2, 0.3, 0.6] as RGB, sky: [0.13, 0.17, 0.32] as RGB, bounce: [0.09, 0.1, 0.17] as RGB, fog: "#232c4d", zenith: "#0c1230" };

export function skyAt(phase: number): Sky {
  const theta = phase * Math.PI * 2;
  const h = sunHeight(phase);
  const x = -Math.cos(theta) * 0.95;
  const z = 0.4;
  const sunDir = norm([x, h * 0.8, z]);
  const moonDir = norm([x, -h * 0.8, z]);

  const day = smooth(-0.14, 0.3, h);
  // golden light peaks with the sun low (either side of the horizon) and is gone by midday and deep night
  const gold = Math.exp(-(((h - 0.08) / 0.26) ** 2));
  // sunlight: weak at the horizon, full by a third of the way up; moonlight: the other way round
  const sunI = smooth(0.0, 0.3, h);
  const moonI = smooth(0.0, 0.22, -h) * 0.62;

  const dayLight = mix3(DAY.sun, GOLD.sun, gold);
  const sun = h >= 0 ? scale3(dayLight, 0.86 * Math.max(sunI, 0.0)) : scale3(NIGHT.sun, moonI);
  // (the sun's weight reaches zero at the horizon just as the moon's starts, so the hand-over has no jump)
  const fill = (key: "sky" | "bounce"): RGB => mix3(NIGHT[key], mix3(DAY[key], GOLD[key], gold * 0.75), day);
  const fog = mixHex(NIGHT.fog, mixHex(DAY.fog, GOLD.fog, gold * 0.85), day);
  const zenith = mixHex(NIGHT.zenith, mixHex(DAY.zenith, GOLD.zenith, gold * 0.7), day);

  const lit = h >= 0 ? sunDir : moonDir;
  const lightDir = norm([lit[0], Math.max(lit[1], MIN_LIGHT_Y), lit[2]]);
  return { height: h, day, night: 1 - smooth(-0.02, 0.34, h), gold, lightDir, sun, sky: fill("sky"), bounce: fill("bounce"), fog, zenith, sunDir, moonDir };
}

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const grey = (c: RGB, k: number): RGB => {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return mix3(c, [l * 0.96, l, l * 1.06], k);
};

/**
 * The same sky under rain cloud (`rain`: 0 clear, 1 pouring): the sun is mostly blocked, so light is soft and shadows
 * faint; colours go grey and a little darker; the haze closes in grey; and the golden hour is lost behind the cloud.
 */
export function overcast(sky: Sky, rain: number): Sky {
  if (rain <= 0.001) return sky;
  const g = Math.min(1, rain);
  const dim = 1 - 0.2 * g;
  const grey3 = (c: RGB, k: number) => scale3(grey(c, k), dim);
  const fogRgb = hexToRgb(sky.fog);
  const fogGrey = scale3(grey(fogRgb, 0.65 * g), 1 - 0.18 * g * sky.day);
  const zenRgb = hexToRgb(sky.zenith);
  return {
    ...sky,
    sun: scale3(sky.sun, 1 - 0.72 * g),
    sky: grey3(sky.sky, 0.55 * g),
    bounce: grey3(sky.bounce, 0.4 * g),
    fog: rgbToHex(fogGrey),
    zenith: rgbToHex(scale3(grey(zenRgb, 0.75 * g), 1 - 0.3 * g * sky.day)),
    gold: sky.gold * (1 - 0.85 * g),
  };
}
