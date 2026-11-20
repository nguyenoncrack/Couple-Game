import { deckBeat, deckPump, musicPosition, presetOf, type Deck, type DeckTrackId, type Music, type Pattern, type PartyLights } from "@cg/shared";
import * as THREE from "three";
import { readyAnalysis, requestAnalysis, useAnalysis } from "../../features/party/deck/analysis/trackAnalysis";
import { lighting } from "../pencil";
import { CALM, grooveOf, LightShow, loudSide, type ShowFrame } from "./lightShow";
import { speakerMotion, stepSpeakerMotion } from "./speakerMotion";

/**
 * The party's shared look. Every lit tile, LED strip and speaker ring is drawn by one of the materials here, and all
 * of them read the same uniforms, which `stepParty` moves once a frame. A tile works out its colour from where it
 * stands in the house, so neighbouring tiles line up into one pattern without being told about each other, and a
 * change of preset reaches every tile at once. Patterns drift slowly, and a change of preset dips the light and
 * brings it back rather than snapping. While the deck plays, the light show (`lightShow.ts`) adds a flash on each
 * beat (at most one a beat), steps the patterns on each bar, follows the music's energy and bursts when a drop hits;
 * steady light, and a device that asks for less motion, keep none of that.
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
  /** 0 to 1: the thump of the kick drum, on each beat, dying away before the next. */
  uPump: { value: 0 },
  /** The beat count, held still for steady light (level meters change their pattern with it). */
  uBeatCount: { value: 0 },
  /** How loud each deck is, 0 to 1, for the mixer's level lights. */
  uMeterA: { value: 0 },
  uMeterB: { value: 0 },
  /** The light show: a flash on each beat (0 to 1), the music's energy (0 to 1), bars on the record's own grid (whole bars and the beat as a fraction), and a drop's burst. */
  uFlash: { value: 0 },
  uChase: { value: 0 },
  uEnergy: { value: CALM.energy },
  uBar: { value: 0 },
  uLift: { value: 0 },
};

// (a handle for watching the light show from the browser's console while developing)
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { __lights: partyUniforms });

const show = new LightShow();
/** This frame's light show, for the beams and spots (set by `stepParty`). */
export let showFrame: ShowFrame = CALM;
let asked: DeckTrackId | null = null;
const analysisOf = (id: DeckTrackId) => readyAnalysis(useAnalysis.getState()[id]);

/** The clock for the mixer and light effects, with a steady 120 bpm fallback for video. */
export function musicPulse(deck: Deck | undefined, music: Music | undefined, nowMs: number): { playing: boolean; beat: number; pump: number; levels: [number, number]; rate: number } {
  if (deck?.playing) {
    const beat = deckBeat(deck, nowMs);
    const pump = deckPump(beat, deck.drop);
    const energy = 0.55 + 0.45 * pump;
    const x = deck.xfade;
    return { playing: true, beat, pump, levels: [Math.cos((x * Math.PI) / 2) * energy, Math.sin((x * Math.PI) / 2) * energy], rate: deck.bpm / 124 };
  }
  if (music?.playing && music.current) {
    const beat = musicPosition(music, nowMs) / 500;
    const pump = 0.55 * Math.exp(-(beat - Math.floor(beat)) * 6);
    const energy = 0.5 + 0.5 * pump;
    return { playing: true, beat, pump, levels: [energy, energy * 0.9], rate: 1 };
  }
  return { playing: false, beat: 0, pump: 0, levels: [0, 0], rate: 0 };
}
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
export function stepParty(lights: PartyLights, music: Music | undefined, nowMs: number, dt: number, centre?: [number, number], deck?: Deck) {
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
  const pulse = musicPulse(deck, music, nowMs);
  u.uBeat.value += ((pulse.playing && lights.on ? 1 : pulse.playing ? 0.5 : 0) - u.uBeat.value) * (1 - Math.exp(-dt * 3));
  if (pulse.playing) u.uSpin.value = (u.uSpin.value + dt * 3.46 * pulse.rate) % (Math.PI * 2);
  // speakers thump and meters dance to the beat; a device that asks for less motion keeps them still
  const still = Boolean(reduced?.matches);
  u.uPump.value = still ? 0 : pulse.pump;
  stepSpeakerMotion(deck, music, nowMs, dt, still, analysisOf);
  lighting.pump.value = speakerMotion.cone;
  u.uBeatCount.value = steady ? 0 : pulse.beat % WRAP;
  const ease = 1 - Math.exp(-dt * 14);
  u.uMeterA.value += ((still ? pulse.levels[0] * 0.7 : pulse.levels[0]) - u.uMeterA.value) * ease;
  u.uMeterB.value += ((still ? pulse.levels[1] * 0.7 : pulse.levels[1]) - u.uMeterB.value) * ease;

  // the light show follows the record everyone hears most (listened to in the background, so the lights land on its beats)
  const beat = deck?.playing ? deckBeat(deck, nowMs) : 0;
  const onAir = deck?.playing && lights.on ? deck[loudSide(deck, beat)] : null;
  if (onAir && onAir !== asked) requestAnalysis(onAir);
  asked = onAir;
  const videoGroove = !deck?.playing && pulse.playing
    ? { beat: pulse.beat, bar: Math.floor(pulse.beat / 4), barBeat: pulse.beat % 4, energy: 0.7, section: null }
    : null;
  showFrame = show.step(lights.on ? grooveOf(deck, beat, analysisOf) ?? videoGroove : null, dt, steady);
  u.uFlash.value = showFrame.flash;
  u.uChase.value = showFrame.active ? 1 : 0;
  u.uEnergy.value = showFrame.energy;
  u.uBar.value = (showFrame.bar + showFrame.barBeat / 4) % WRAP;
  u.uLift.value = showFrame.lift;
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
  uniform float uTime, uLevel, uCount, uPattern, uPeriod, uSteady, uBeat, uSpin, uPump, uBeatCount, uMeterA, uMeterB, uFlash, uChase, uEnergy, uBar, uLift;
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
      // Chase diagonal bands across the tiles, paced by the record. Reverse on alternate bars.
      float drive = 0.5 + 0.85 * uEnergy;
      float direction = mix(1.0, -1.0, mod(floor(uBar), 2.0));
      float stripe = fract((floor(p.x) + direction * floor(p.y)) * 0.28 - uBar * 3.0);
      float chase = (1.0 - smoothstep(0.08, 0.36, abs(stripe - 0.5))) * uChase * smoothstep(0.28, 0.83, uEnergy);
      vec3 glow = palAt(spot(p) + chase * 0.5 + floor(uBar) * 0.21 * uChase) * breathe();
      float flash = uFlash * (0.3 + 1.25 * chase);
      // a drop's burst: a bright ring racing out across the floor
      float front = (1.0 - uLift) * 14.0;
      float ring = uLift * exp(-pow((length(p - uCentre) - front) * 1.2, 2.0)) * (1.0 - uSteady);
      vec3 lit = glow * drive * (0.78 + 0.8 * chase + 1.15 * flash) + (vec3(0.18) + glow * 0.55) * (0.4 * flash + 1.65 * ring);
      vec3 glass = vec3(0.045, 0.047, 0.07);
      vec3 col = glass + lit * uLevel * (0.5 + 0.75 * led) * panel + glow * uLevel * (0.22 + 0.3 * flash) * (1.0 - panel);
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
      // brighter on each kick while music plays (steady light holds it level)
      float lit = uLevel * (0.55 + 0.45 * uBeat) * (1.0 + (0.32 * uPump + 0.8 * uFlash + 0.6 * uLift) * (1.0 - uSteady));
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

/**
 * A music player's display: seven bars of an equaliser that jump with the beat, in the party's colours. Drawn from
 * where each point sits on its panel (`size`, in metres, across x and y), so it fits any panel it's put on.
 */
export function equaliserMaterial(size: [number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...partyUniforms, uSize: { value: new THREE.Vector2(...size) } },
    toneMapped: false,
    vertexShader: vertex,
    fragmentShader: /* glsl */ `
      varying vec3 vModel;
      varying vec3 vCenter;
      uniform vec2 uSize;
      ${common}
      float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
      void main() {
        vec2 q = clamp((vModel.xy - vCenter.xy) / uSize + 0.5, 0.0, 1.0);
        float x = q.x * 7.0;
        float i = floor(x);
        float gap = step(0.16, fract(x)) * step(fract(x), 0.84);
        // each bar takes a new height twice a beat, and the whole lot kicks up with the drum
        float h = hash(i * 3.1 + floor(uBeatCount * 2.0) * 7.7);
        float playing = step(0.02, uMeterA + uMeterB);
        float level = mix(0.08, (0.22 + 0.62 * h) * (0.6 + 0.4 * uPump) + 0.1, playing);
        float cell = step(0.22, fract(q.y * 6.0));
        float on = step(q.y, level) * gap * cell;
        vec3 bar = palAt(q.x * 0.6 + q.y * 0.3) * (0.35 + 0.65 * max(uLevel, 0.6));
        vec3 col = vec3(0.025, 0.03, 0.05) + bar * on + bar * 0.06 * gap * cell;
        gl_FragColor = vec4(col, 1.0);
        ${out}
      }
    `,
  });
}

/**
 * A mixer's level lights: little lamps in a column that light from one end with the deck's level (deck A's on the
 * left, B's on the right), green, then amber, then pink at the top. `first` is where the column starts along z and
 * `step` how far apart the lamps are.
 */
export function levelLightsMaterial(first: number, step: number, count: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...partyUniforms, uFirst: { value: first }, uStep: { value: step }, uLamps: { value: count } },
    toneMapped: false,
    vertexShader: vertex,
    fragmentShader: /* glsl */ `
      varying vec3 vCenter;
      uniform float uFirst, uStep, uLamps;
      ${common}
      void main() {
        float i = floor((vCenter.z - uFirst) / uStep + 0.5);
        float level = vCenter.x < 0.0 ? uMeterA : uMeterB;
        float lit = step(i + 0.5, level * uLamps + 0.35);
        float top = i / max(1.0, uLamps - 1.0);
        vec3 hue = top > 0.85 ? vec3(1.0, 0.24, 0.6) : top > 0.55 ? vec3(1.0, 0.82, 0.4) : vec3(0.55, 1.0, 0.23);
        vec3 col = mix(hue * 0.08, hue, lit);
        gl_FragColor = vec4(col, 1.0);
        ${out}
      }
    `,
  });
}

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
          vec3 col = uTint * lum + palAt(h + 0.3) * (0.28 * tw + 0.45 * uFlash * (1.0 - uSteady)) * uLevel;
          gl_FragColor = vec4(col, 1.0);
          ${out}
        }
      `,
    });
    balls.set(tint, m);
  }
  return m;
}
