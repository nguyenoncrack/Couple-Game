import { presetOf, type Music, type Pattern, type PartyLights } from "@cg/shared";
import * as THREE from "three";

/**
 * The party's shared look. Every lit tile, LED strip and speaker ring is drawn by one of the materials here, and all
 * of them read the same uniforms, which `stepParty` moves once a frame. A tile works out its colour from where it
 * stands in the house, so neighbouring tiles line up into one pattern without being told about each other, and a
 * change of preset reaches every tile at once. Nothing here flashes: patterns are slow drifts, and a change of
 * preset dips the light and brings it back rather than snapping.
 */

/** Every period divides this many seconds, so the clock can wrap without a visible jump. */
export const WRAP = 5040;
export const partyTime = (nowMs: number) => (nowMs / 1000) % WRAP;

const PATTERN: Record<Pattern, number> = { sweep: 0, ripple: 1, checker: 2, pulse: 3 };
const SLOTS = 5;

export const partyUniforms = {
  uTime: { value: 3 },
  /** 0 to 1: how bright everything is, easing with the lights on or off and with a change of preset. */
  uLevel: { value: 1 },
  uPalette: { value: Array.from({ length: SLOTS }, () => new THREE.Color()) },
  uCount: { value: 4 },
  uPattern: { value: PATTERN.ripple },
  uPeriod: { value: 10 },
  uSteady: { value: 0 },
  /** The middle of the lot, for rings that spread out from it. */
  uCentre: { value: new THREE.Vector2(12, 10) },
  /** 0 to 1: how much the music is playing (speakers glow and the records turn). */
  uBeat: { value: 0 },
  uSpin: { value: 0 },
};
setPalette(["#00e5ff", "#ff2bd6", "#8a4dff", "#39ff88"]);

function setPalette(hexes: readonly string[], into = partyUniforms.uPalette.value) {
  const n = Math.min(SLOTS, hexes.length);
  for (let i = 0; i < SLOTS; i++) into[i]!.set(hexes[i % n]!);
  partyUniforms.uCount.value = n;
}

/** What the lights ask for: a palette (one colour if a single colour is chosen), a pattern and its period. */
export function lookOf(lights: PartyLights): { palette: readonly string[]; pattern: Pattern; period: number } {
  const preset = presetOf(lights.preset);
  if (lights.color) return { palette: [lights.color, lights.color, lights.color], pattern: "pulse", period: 18 };
  return { palette: preset.palette, pattern: preset.pattern, period: preset.period };
}

/** The colour at position `u` round the current palette (as the shaders blend it), written into `out`. */
export function paletteAt(u: number, out = new THREE.Color()): THREE.Color {
  const pal = partyUniforms.uPalette.value;
  const n = partyUniforms.uCount.value;
  const x = (u - Math.floor(u)) * n;
  const i = Math.floor(x);
  const f = x - i;
  return out.copy(pal[i % SLOTS]!).lerp(pal[(i + 1) % n % SLOTS]!, f * f * (3 - 2 * f));
}

const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
/** Steady light: asked for, or the viewer's system asks for less motion. */
export const steadyFor = (lights: Pick<PartyLights, "steady">) => lights.steady || Boolean(reduced?.matches);

let seen = "";
/** How far through a change of look we are: 0 while settled, climbing to 1 and back as the light dips and returns. */
let dip = 0;
let pending: ReturnType<typeof lookOf> | null = null;
const target = Array.from({ length: SLOTS }, () => new THREE.Color());

/** Move the shared uniforms on: the clock, the brightness and the palette, easing each. */
export function stepParty(lights: PartyLights, music: Music | undefined, nowMs: number, dt: number, centre?: [number, number]) {
  const u = partyUniforms;
  u.uTime.value = partyTime(nowMs);
  if (centre) u.uCentre.value.set(centre[0], centre[1]);
  const steady = steadyFor(lights);
  u.uSteady.value = steady ? 1 : 0;

  const look = lookOf(lights);
  const key = `${look.palette.join()}|${look.pattern}|${look.period}`;
  if (key !== seen) {
    // the very first look is taken as it comes; after that, dip the light, swap under it, and come back up
    if (seen === "") apply(look);
    else {
      pending = look;
      dip = Math.max(dip, 0.0001);
    }
    seen = key;
  }
  if (pending) {
    dip = Math.min(1, dip + dt / 0.35);
    if (dip >= 1) {
      apply(pending);
      pending = null;
    }
  } else dip = Math.max(0, dip - dt / 0.35);
  // the palette eases towards its target, so a colour change is a glide
  const k = 1 - Math.exp(-dt * 2.5);
  for (let i = 0; i < SLOTS; i++) u.uPalette.value[i]!.lerp(target[i]!, k);

  const want = (lights.on ? 0.15 + 0.85 * lights.brightness : 0) * (1 - 0.6 * dip);
  u.uLevel.value += (want - u.uLevel.value) * (1 - Math.exp(-dt * 3.5));
  u.uBeat.value += ((music?.playing && lights.on ? 1 : music?.playing ? 0.5 : 0) - u.uBeat.value) * (1 - Math.exp(-dt * 3));
  if (music?.playing) u.uSpin.value = (u.uSpin.value + dt * 3.46) % (Math.PI * 2);
}

function apply(look: ReturnType<typeof lookOf>) {
  const u = partyUniforms;
  const first = seen === "";
  setPalette(look.palette, first ? u.uPalette.value : target);
  if (first) for (let i = 0; i < SLOTS; i++) target[i]!.copy(u.uPalette.value[i]!);
  else {
    // the count changes at once, and each slot glides to its colour
    u.uCount.value = Math.min(SLOTS, look.palette.length);
  }
  u.uPattern.value = PATTERN[look.pattern];
  u.uPeriod.value = look.period;
}

const common = /* glsl */ `
  uniform float uTime, uLevel, uCount, uPattern, uPeriod, uSteady, uBeat, uSpin;
  uniform vec3 uPalette[${SLOTS}];
  uniform vec2 uCentre;
  vec3 palAt(float u) {
    float x = fract(u) * uCount;
    float i0 = floor(x);
    float f = x - i0;
    f = f * f * (3.0 - 2.0 * f);
    int a = int(i0);
    int b = int(mod(i0 + 1.0, uCount));
    return mix(uPalette[a], uPalette[b], f);
  }
  // where in the palette a spot of the house is, for the pattern in use
  float spot(vec2 p) {
    float t = uSteady > 0.5 ? 0.0 : uTime;
    if (uPattern < 0.5) return (p.x + p.y) * 0.07 - t / uPeriod;
    if (uPattern < 1.5) return length(p - uCentre) * 0.12 - t / uPeriod;
    if (uPattern < 2.5) return mod(floor(p.x) + floor(p.y), 2.0) * 0.5 + t / uPeriod;
    return p.x * 0.02 + t / (uPeriod * 2.0);
  }
  float breathe() {
    return uSteady > 0.5 ? 1.0 : 0.88 + 0.12 * sin(uTime * 6.2831853 * 2.0 / uPeriod);
  }
`;

const out = /* glsl */ `
  #include <colorspace_fragment>
`;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vModel;
  varying vec3 vNormalW;
  attribute vec3 aCenter;
  varying vec3 vCenter;
  void main() {
    vModel = position;
    vCenter = aCenter;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** A dance-floor tile's lit top: a glass panel with a dot grid, painted by where it stands in the house. */
export const tileMaterial = new THREE.ShaderMaterial({
  uniforms: partyUniforms,
  toneMapped: false,
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
    varying vec3 vWorld;
    ${common}
    void main() {
      vec2 p = vWorld.xz;
      vec2 cell = fract(p);
      float edge = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
      // a bevelled rim round each tile, then a fine grid of LED dots (four to the metre each way)
      float panel = smoothstep(0.035, 0.075, edge);
      vec2 g = fract(p * 4.0) - 0.5;
      float led = 1.0 - smoothstep(0.17, 0.3, length(g));
      vec3 glow = palAt(spot(p)) * breathe();
      vec3 glass = vec3(0.045, 0.047, 0.07);
      vec3 col = glass + glow * uLevel * (0.38 + 0.62 * led) * panel + glow * uLevel * 0.2 * (1.0 - panel);
      // a faint sheen, fixed to the room, so the glass reads as glass
      col += vec3(0.06, 0.065, 0.09) * smoothstep(0.25, 0.0, abs(fract((p.x - p.y) * 0.5) - 0.5));
      gl_FragColor = vec4(col, 1.0);
      ${out}
    }
  `,
});

/** Lit strips and rings: the palette flows up them. */
export const glowMaterial = new THREE.ShaderMaterial({
  uniforms: partyUniforms,
  toneMapped: false,
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
    varying vec3 vWorld;
    ${common}
    void main() {
      vec2 p = vec2(vWorld.x + vWorld.z, vWorld.y * 2.5);
      vec3 glow = palAt(spot(vec2(vWorld.x, vWorld.z)) + vWorld.y * 0.12) * breathe();
      float lit = uLevel * (0.55 + 0.45 * uBeat);
      vec3 col = vec3(0.03) + glow * (0.15 + 0.85 * lit);
      gl_FragColor = vec4(col, 1.0);
      ${out}
    }
  `,
});

/** A record on a deck: dark vinyl with fine grooves, a bright label, and a highlight that turns with the music. */
export const platterMaterial = new THREE.ShaderMaterial({
  uniforms: partyUniforms,
  toneMapped: false,
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
    varying vec3 vModel;
    varying vec3 vCenter;
    ${common}
    void main() {
      vec2 q = vModel.xz - vCenter.xz;
      float r = length(q);
      float a = atan(q.y, q.x) - uSpin;
      float groove = 0.5 + 0.5 * sin(r * 380.0);
      vec3 col = vec3(0.04) + vec3(0.03) * groove;
      col += vec3(0.5) * pow(max(0.0, cos(a * 2.0)), 10.0) * smoothstep(0.03, 0.06, r) * (1.0 - smoothstep(0.14, 0.17, r));
      float label = 1.0 - smoothstep(0.045, 0.05, r);
      col = mix(col, palAt(0.1) * (0.4 + 0.6 * uLevel), label);
      gl_FragColor = vec4(col, 1.0);
      ${out}
    }
  `,
});

const balls = new Map<string, THREE.ShaderMaterial>();

/** A mirror ball: small flat facets that each catch the light differently, shimmering slowly. */
export function mirrorBallMaterial(tint: string): THREE.ShaderMaterial {
  let m = balls.get(tint);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { ...partyUniforms, uTint: { value: new THREE.Color(tint) } },
      toneMapped: false,
      vertexShader: vertex,
      fragmentShader: /* glsl */ `
        varying vec3 vModel;
        varying vec3 vNormalW;
        uniform vec3 uTint;
        ${common}
        float hash(vec3 v) { return fract(sin(dot(v, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 f = floor(normalize(vModel) * 9.0);
          float h = hash(f);
          float tw = uSteady > 0.5 ? 0.5 : 0.5 + 0.5 * sin(uTime * 0.9 + h * 40.0);
          float lum = 0.55 + 0.3 * h + 0.25 * tw * (0.4 + uLevel);
          vec3 col = uTint * lum + palAt(h + 0.3) * 0.28 * uLevel * tw;
          gl_FragColor = vec4(col, 1.0);
          ${out}
        }
      `,
    });
    balls.set(tint, m);
  }
  return m;
}
