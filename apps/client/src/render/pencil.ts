import * as THREE from "three";

/**
 * Pencil rendering, carried over from the Museum of Nguyen and tuned for interiors.
 *
 * Every surface uses `pencilMaterial`: a soft tone on warm paper, graphite crosshatching that builds up in darker
 * areas, faint paper grain, and a wobbly graphite rim on curved edges. Hatching is computed from world position
 * (triplanar), so it stays glued to surfaces while the camera moves. Finishes (boards, tile, plaster, fabric…) are
 * drawn as pencil lines on top. Outlines are inverted hulls (`outlineMaterial`).
 */

export const PAPER = "#f3ede0";
export const INK = "#3a3631";
export const FOG = "#f4ecd9";

/** Colors go to the shaders in sRGB so the pencil mixing happens in the same space as the page. */
const srgb = (hex: string) => new THREE.Color(hex).convertLinearToSRGB();

/** A warm late-morning sun from the southwest. */
export const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.45).normalize();

const fogGlsl = /* glsl */ `
  float fogAt(float d) {
    return pow(smoothstep(55.0, 190.0, d), 0.9);
  }
`;
const fogUniform = { value: srgb(FOG) };

export const lighting = {
  tint: { value: new THREE.Color(1, 1, 1) },
  time: { value: 0 },
  sat: { value: 1.15 },
};

const pencilVertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix;
    #else
      mat4 m = modelMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const shared = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  // One family of parallel pencil strokes. Returns 1 on a stroke, 0 between strokes.
  float strokes(vec2 p, float angle, float density, float width, vec3 seed) {
    float c = cos(angle), s = sin(angle);
    vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float wobble = noise(vec3(r.x * 0.9, r.y * 0.25, seed.x)) * 0.35;
    float v = abs(fract(r.y * density + wobble) - 0.5);
    float line = 1.0 - smoothstep(width * 0.55, width, v);
    float gaps = smoothstep(0.18, 0.42, noise(vec3(r.x * 1.7, r.y * density * 0.5, seed.y)));
    return line * gaps;
  }
`;

const pencilFragment = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uTone;
  uniform vec3 uInk;
  uniform vec3 uLightDir;
  uniform float uDensity;
  uniform float uRim;
  uniform vec3 uHighlight;
  uniform float uHighlightAmt;
  uniform float uAlpha;
  uniform vec3 uFog;
  uniform vec3 uTint;
  uniform float uSat;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  ${shared}
  ${fogGlsl}

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 an = abs(n);
    vec2 p = an.y > an.x && an.y > an.z ? vWorldPos.xz : (an.x > an.z ? vWorldPos.zy : vWorldPos.xy);

    float diffuse = dot(n, uLightDir);
    float light = 0.8 + 0.16 * n.y + 0.12 * diffuse;
    light -= 0.18 * max(-n.y, 0.0);
    float dark = 1.0 - light;
    // Grime and shade where walls and furniture meet the floor: a soft band of extra hatching low down.
    dark += (1.0 - smoothstep(0.0, 0.22, vWorldPos.y)) * (1.0 - an.y) * 0.14;

    vec3 tone = uTone;
    float lines = 0.0;
    #ifdef FINISH
      vec2 side = normalize(vec2(-n.z, n.x) + vec2(1e-4, 0.0));
      vec2 fp = an.y > 0.72 ? vWorldPos.xz : vec2(dot(vWorldPos.xz, side), vWorldPos.y);
      float tv = 0.0;
      #if FINISH == 1
        // plaster: soft cloudy patches, the odd hairline crack
        tv = (noise(vWorldPos * 0.6) - 0.5) * 0.08 + (noise(vWorldPos * 2.7) - 0.5) * 0.035;
        lines = strokes(fp * vec2(0.35, 0.2), 1.1, 0.6, 0.04, vec3(4.0, 8.0, 0.0)) * step(0.84, noise(vWorldPos * 0.5 + 2.0)) * 0.45;
      #elif FINISH == 2
        // wood: boards with seams, staggered butt joints and a wandering grain
        float bw = 0.18;
        float row = floor(fp.y / bw);
        float seam = 1.0 - smoothstep(0.0, 0.02, abs(fract(fp.y / bw) - 0.5) - 0.46);
        float blen = 1.4 + hash(vec3(row, 3.0, 1.0)) * 0.8;
        float butt = 1.0 - smoothstep(0.0, 0.02, abs(fract(fp.x / blen + hash(vec3(row, 9.0, 2.0))) - 0.5) - 0.485);
        float grain2 = strokes(vec2(fp.x * 0.35, fp.y * 2.6 + noise(vec3(fp * 1.7, row)) * 0.7), 0.0, 2.6, 0.07, vec3(row, 2.0, 0.0));
        float knot = 1.0 - smoothstep(0.015, 0.03, length(fract(vec2(fp.x / blen * 2.3, fp.y / bw) + hash(vec3(row, 1.0, 5.0))) - 0.5) * 0.4);
        lines = max(max(seam * 0.7, butt * 0.6), max(grain2 * 0.28, knot * step(0.7, hash(vec3(row, floor(fp.x / blen), 4.0))) * 0.5));
        tv = (hash(vec3(row, floor(fp.x / blen + hash(vec3(row, 9.0, 2.0))), 3.0)) - 0.5) * 0.12;
      #elif FINISH == 3
        // stone: ashlar courses of uneven blocks
        float ch = 0.34;
        float row = floor(fp.y / ch);
        float len = 0.5 + hash(vec3(row, 5.0, 1.0)) * 0.45;
        float cx = (fp.x + hash(vec3(row, 2.0, 7.0)) * 3.0) / len;
        float mh = 1.0 - smoothstep(0.0, 0.035, abs(fract(fp.y / ch) - 0.5) - 0.44);
        float mv = 1.0 - smoothstep(0.0, 0.06, abs(fract(cx) - 0.5) - 0.43);
        lines = max(mh, mv) * 0.8;
        tv = (hash(vec3(row, floor(cx), 9.0)) - 0.5) * 0.14 + (noise(vWorldPos * 2.2) - 0.5) * 0.05;
      #elif FINISH == 4
        // brick: running bond
        vec2 bq = vec2(fp.x / 0.42, fp.y / 0.18);
        float br = floor(bq.y);
        bq.x += mod(br, 2.0) * 0.5;
        float mh = 1.0 - smoothstep(0.0, 0.06, abs(fract(bq.y) - 0.5) - 0.42);
        float mv = 1.0 - smoothstep(0.0, 0.05, abs(fract(bq.x) - 0.5) - 0.45);
        lines = max(mh, mv) * 0.6;
        tv = (hash(vec3(floor(bq), 4.0)) - 0.5) * 0.16;
      #elif FINISH == 5
        // checker tile: square tiles with grout, every other one a shade darker, the odd crazed glaze
        vec2 tq = fp / 0.33;
        vec2 tf = abs(fract(tq) - 0.5);
        float grout = 1.0 - smoothstep(0.0, 0.03, max(tf.x, tf.y) - 0.45);
        lines = grout * 0.65;
        float alt = mod(floor(tq.x) + floor(tq.y), 2.0);
        tv = -alt * 0.12 + (hash(vec3(floor(tq), 3.0)) - 0.5) * 0.05;
        // a glint of glaze toward the light
        tv += (1.0 - smoothstep(0.0, 0.3, length(fract(tq) - vec2(0.3, 0.7)))) * 0.05;
      #elif FINISH == 6
        // setts: small squared stones in a running bond
        vec2 bq = vec2(fp.x / 0.3, fp.y / 0.22);
        float br = floor(bq.y);
        bq.x += mod(br, 2.0) * 0.5 + hash(vec3(br, 3.0, 1.0)) * 0.2;
        float mh = 1.0 - smoothstep(0.0, 0.08, abs(fract(bq.y) - 0.5) - 0.4);
        float mv = 1.0 - smoothstep(0.0, 0.08, abs(fract(bq.x) - 0.5) - 0.4);
        lines = max(mh, mv) * 0.55;
        float hv = hash(vec3(floor(bq), 2.0));
        tv = (hv - 0.5) * 0.14 - step(0.93, hv) * 0.12;
      #elif FINISH == 7
        // concrete: speckled grain and faint control joints
        float joint = 1.0 - smoothstep(0.0, 0.015, 0.5 - max(abs(fract(fp.x / 2.0) - 0.5), abs(fract(fp.y / 2.0) - 0.5)));
        lines = joint * 0.35;
        tv = (noise(vWorldPos * 0.7) - 0.5) * 0.07 + (hash(floor(vWorldPos * 16.0)) - 0.5) * 0.04;
      #elif FINISH == 8
        // carpet: soft pile with short scattered strokes
        tv = (noise(vWorldPos * 3.0) - 0.5) * 0.06 + (noise(vWorldPos * 14.0) - 0.5) * 0.05;
        lines = strokes(fp * 3.0, 0.9, 1.4, 0.05, vec3(6.0, 1.0, 0.0)) * 0.22;
      #elif FINISH == 9
        // fabric: a fine weave
        float weft = strokes(fp, 0.0, 22.0, 0.18, vec3(2.0, 5.0, 0.0));
        float warp = strokes(fp, 1.5708, 22.0, 0.18, vec3(7.0, 3.0, 0.0));
        lines = max(weft, warp) * 0.18;
        tv = (noise(vWorldPos * 5.0) - 0.5) * 0.06;
      #elif FINISH == 10
        // lawn: patchy greens, the odd dry patch, short pencilled blades
        float n1 = noise(vWorldPos * 0.16);
        float n2 = noise(vWorldPos * 0.85);
        float n3 = noise(vWorldPos * 0.045 + 3.0);
        vec3 grass = mix(vec3(0.60, 0.71, 0.43), vec3(0.47, 0.61, 0.38), n1);
        grass = mix(grass, vec3(0.74, 0.72, 0.51), smoothstep(0.58, 0.85, n3) * 0.6);
        tone = grass * (0.9 + 0.16 * n2);
        lines = strokes(p, 1.35, 2.3, 0.07, vec3(2.0, 6.0, 0.0)) * 0.5;
      #endif
      tone *= 1.0 + tv;
    #endif
    vec3 base = mix(uPaper, tone, 0.88);

    float density = uDensity;
    float h = 0.0;
    h += strokes(p, 0.785, density, 0.13, vec3(1.3, 4.1, 0.0)) * smoothstep(0.17, 0.23, dark);
    h += strokes(p, -0.785, density * 1.1, 0.12, vec3(7.7, 2.9, 0.0)) * smoothstep(0.27, 0.33, dark);
    h += strokes(p, 0.05, density * 1.25, 0.11, vec3(3.1, 9.4, 0.0)) * smoothstep(0.36, 0.42, dark);
    h = clamp(h, 0.0, 1.0);
    // Far away, strokes thinner than a pixel shimmer; blend them into a flat graphite tone instead.
    float fw = length(fwidth(p)) * density;
    float aa = 1.0 - smoothstep(0.2, 0.7, fw);
    h = mix(smoothstep(0.17, 0.5, dark) * 0.35, h, aa);
    float lfw = length(fwidth(p)) * 6.0;
    h = max(h, lines * (1.0 - smoothstep(0.3, 1.0, lfw)));

    // Wobbly graphite contour where curved surfaces turn away from the camera.
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float facing = abs(dot(n, viewDir));
    float rimEdge = 0.22 + noise(vWorldPos * 4.0) * 0.12;
    float curve = smoothstep(0.004, 0.03, length(fwidth(n)));
    float rim = (1.0 - smoothstep(rimEdge, rimEdge + 0.08, facing)) * uRim * curve;

    float grain = noise(vWorldPos * 38.0) * 0.018 + noise(vWorldPos * 9.0) * 0.014;

    vec3 col = base * (0.93 + 0.07 * light) - grain;
    col = mix(col, uInk, h * 0.24);
    col = mix(col, uInk, rim * 0.75);
    float sunFace = max(diffuse, 0.0);
    col = mix(col, col * vec3(1.07, 1.0, 0.88), sunFace * 0.8);
    col = mix(col, col * vec3(0.92, 0.96, 1.06), max(-diffuse, 0.0) * 0.85);
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = clamp(mix(vec3(luma), col, uSat), 0.0, 1.0);
    col = mix(col, uHighlight, uHighlightAmt);
    col *= uTint;
    col = mix(col, uFog, fogAt(length(cameraPosition - vWorldPos)));
    gl_FragColor = vec4(col, uAlpha);
  }
`;

const FINISHES = { plaster: 1, wood: 2, stone: 3, brick: 4, checker: 5, setts: 6, concrete: 7, carpet: 8, fabric: 9, lawn: 10 } as const;
export type Finish = keyof typeof FINISHES;

export interface PencilOptions {
  density?: number;
  rim?: boolean;
  finish?: Finish;
  /** Drawn see-through, tinted: furniture you're carrying before you drop it. */
  ghost?: "ok" | "bad";
}

const cache = new Map<string, THREE.ShaderMaterial>();

/** Shared pencil material. Calls with the same arguments return the same instance. */
export function pencilMaterial(tone: string = PAPER, opts: PencilOptions = {}) {
  const key = `${tone}|${opts.density ?? 6}|${opts.rim === false ? 0 : 1}|${opts.finish ?? ""}|${opts.ghost ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    const ghost = opts.ghost;
    m = new THREE.ShaderMaterial({
      vertexShader: pencilVertex,
      fragmentShader: pencilFragment,
      uniforms: {
        uPaper: { value: srgb(PAPER) },
        uTone: { value: srgb(tone) },
        uInk: { value: srgb(INK) },
        uLightDir: { value: SUN_DIR },
        uDensity: { value: opts.density ?? 6 },
        uRim: { value: opts.rim === false ? 0 : 1 },
        uHighlight: { value: srgb(ghost === "bad" ? "#e0675a" : "#9ccf8a") },
        uHighlightAmt: { value: ghost ? 0.3 : 0 },
        uAlpha: { value: ghost ? 0.72 : 1 },
        uFog: fogUniform,
        uTint: lighting.tint,
        uSat: lighting.sat,
      },
      transparent: Boolean(ghost),
      depthWrite: !ghost,
      defines: opts.finish ? { FINISH: FINISHES[opts.finish] } : {},
    });
    cache.set(key, m);
  }
  return m;
}

const outlineVertex = /* glsl */ `
  uniform float uThickness;
  uniform float uRadial;
  #ifdef MERGED
    attribute vec3 aCenter;
  #endif
  varying float vFog;
  float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  ${fogGlsl}
  void main() {
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix;
    #else
      mat4 m = modelMatrix;
    #endif
    vec3 s = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));
    float jitter = 0.6 + 0.8 * h(floor(position * 7.0 + 0.5));
    #ifdef MERGED
      vec3 dir = normalize(mix(normal, normalize(position - aCenter + 1e-5), uRadial));
      vec3 pushed = position + dir * uThickness * jitter;
    #else
      vec3 dir = normalize(mix(normal, normalize(position + 1e-5), uRadial));
      vec3 pushed = position + dir * uThickness * jitter / s;
    #endif
    vec4 world = m * vec4(pushed, 1.0);
    vFog = fogAt(length(cameraPosition - world.xyz));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const outlineFragment = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uFog;
  uniform float uAlpha;
  varying float vFog;
  void main() {
    gl_FragColor = vec4(mix(uInk, uFog, vFog), uAlpha);
  }
`;

const outlineCache = new Map<string, THREE.ShaderMaterial>();

/**
 * Hand-drawn outline: an inverted hull pushed out along the normals (or out from each part's center), with a
 * little static per-vertex noise so the contour isn't machine-perfect.
 */
export function outlineMaterial(thickness = 0.02, radial = true, merged = false, ghost = false) {
  const key = `${thickness}|${radial}|${merged}|${ghost}`;
  let m = outlineCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      uniforms: { uThickness: { value: thickness }, uRadial: { value: radial ? 1 : 0 }, uInk: { value: srgb(INK) }, uFog: fogUniform, uAlpha: { value: ghost ? 0.5 : 1 } },
      side: THREE.BackSide,
      transparent: ghost,
      depthWrite: !ghost,
      defines: merged ? { MERGED: 1 } : {},
    });
    outlineCache.set(key, m);
  }
  return m;
}

const shadowVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Soft hatched contact shadow: a rounded patch of graphite strokes that fades toward its edge. */
const shadowFragment = /* glsl */ `
  uniform vec3 uInk;
  uniform float uStrength;
  uniform vec2 uSize;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  ${shared}
  void main() {
    // distance to a rounded rectangle, in metres, so the falloff is the same width for any size
    vec2 q = abs(vUv - 0.5) * uSize - (uSize * 0.5 - 0.25);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float fall = 1.0 - smoothstep(-0.12, 0.25, d);
    float lines = max(strokes(vWorldPos.xz, 0.785, 11.0, 0.24, vec3(4.0, 1.0, 0.0)),
                      strokes(vWorldPos.xz, -0.785, 11.0, 0.22, vec3(8.0, 3.0, 0.0)) * step(0.6, fall));
    gl_FragColor = vec4(uInk, (lines * 0.7 + 0.3) * fall * uStrength);
  }
`;

const shadowCache = new Map<string, THREE.ShaderMaterial>();

/** A contact shadow material for a footprint of this size (metres). */
export function shadowMaterial(w: number, d: number, strength = 0.3) {
  const key = `${w}|${d}|${strength}`;
  const hit = shadowCache.get(key);
  if (hit) return hit;
  const m = new THREE.ShaderMaterial({
    vertexShader: shadowVertex,
    fragmentShader: shadowFragment,
    uniforms: { uInk: { value: srgb(INK) }, uStrength: { value: strength }, uSize: { value: new THREE.Vector2(w, d) } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  shadowCache.set(key, m);
  return m;
}
