import * as THREE from "three";
import { itemFinishesGlsl, materialDetailGlsl } from "./materialDetail";

/**
 * Pencil rendering, carried over from the Museum of Nguyen and tuned for interiors.
 *
 * Every surface uses `pencilMaterial`: a soft tone on warm paper, graphite crosshatching that builds up in darker
 * areas, faint paper grain, and a wobbly graphite rim on curved edges. Hatching and item detail use object-local
 * coordinates, so they stay glued to surfaces while the camera, furniture or characters move. Finishes (boards, tile, plaster, fabric…) are
 * drawn as pencil lines on top. Outlines are inverted hulls (`outlineMaterial`).
 */

export const PAPER = "#f3ede0";
export const INK = "#3a3631";
/** The air at the horizon: a pale, slightly cool sky, so distance reads as depth rather than a yellow haze. */
export const FOG = "#e9ede4";

/** Colors go to the shaders in sRGB so the pencil mixing happens in the same space as the page. */
const srgb = (hex: string) => new THREE.Color(hex).convertLinearToSRGB();

/** A warm late-morning sun from the southwest. */
export const SUN_DIR = new THREE.Vector3(-0.5, 0.75, 0.45).normalize();

const fogGlsl = /* glsl */ `
  float fogAt(float d) {
    return pow(smoothstep(60.0, 200.0, d), 0.9);
  }
`;
const fogUniform = { value: srgb(FOG) };

/**
 * Light shared by every pencil surface. `Sunlight` fills in the sun's shadow map and the overhead height map
 * (for contact shadows) while the main view is drawn, and clears them again afterwards, so other canvases (the
 * catalog pictures, the character preview) draw the same materials without them.
 */
export const lighting = {
  tint: { value: new THREE.Color(1, 1, 1) },
  time: { value: 0 },
  /** How much the scene's softer colours are lifted; already-saturated ones are left nearly alone. */
  vibrance: { value: 0.3 },
  /** The middle of the lot (x, z) and its radius: things further out are drawn quieter. */
  focus: { value: new THREE.Vector3(0, 0, 1e4) },
  shadowMap: { value: null as THREE.Texture | null },
  shadowMatrix: { value: new THREE.Matrix4() },
  shadowOn: { value: 0 },
  shadowTexel: { value: 1 / 2048 },
  heightMap: { value: null as THREE.Texture | null },
  heightMatrix: { value: new THREE.Matrix4() },
  /** Metres per unit of the height map, and one metre in its texture coordinates (x, z). */
  heightScale: { value: new THREE.Vector3(8, 0, 0) },
  heightOn: { value: 0 },
  /** How strong the drawn contact patches under furniture are (full when there are no real shadows). */
  contact: { value: 1 },
  /** How hard the breeze blows on plants that sway (0 holds them still, for people who'd rather less motion). */
  wind: { value: 1 },
};

/** The way the breeze blows (x, z): plants lean this way and leaves drift with it. */
export const WIND: [number, number] = [0.87, 0.49];

/**
 * The breeze, for plants that sway: everything above the ground leans downwind and rocks, more the higher up it
 * is (by the square of its height, so a stem's foot stays put), in slow gusts that roll across the countryside.
 * It works in world space, so merged kits and instanced meshes sway alike and their outlines move with them.
 */
const swayGlsl = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform float uWind;
  vec3 sway(vec3 p) {
    float h = max(p.y, 0.0);
    float gust = 0.55 + 0.45 * sin(uTime * 0.31 + p.x * 0.045 - p.z * 0.03);
    float rock = sin(uTime * 1.6 + p.x * 0.35 + p.z * 0.22) * 0.75 + sin(uTime * 2.7 - p.x * 0.8 + p.z * 0.6) * 0.25;
    return vec3(${WIND[0]}, 0.0, ${WIND[1]}) * (0.35 + rock) * gust * h * h * uSway * uWind;
  }
`;

const pencilVertex = /* glsl */ `
  #ifdef SWAY
    ${swayGlsl}
  #endif
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vSurfacePos;
  varying vec3 vSurfaceNormal;
  #if defined(FINISH) && (FINISH == 11 || FINISH == 15 || FINISH == 18)
    varying vec2 vUv;
  #endif
  void main() {
    #if defined(FINISH) && (FINISH == 11 || FINISH == 15 || FINISH == 18)
      vUv = uv;
    #endif
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix;
    #else
      mat4 m = modelMatrix;
    #endif
    vec3 local = position;
    #if defined(FINISH) && FINISH == 27
      vec3 anchor = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      local *= 1.0 - smoothstep(32.0, 55.0, distance(cameraPosition, anchor));
    #endif
    vec4 world = m * vec4(local, 1.0);
    #ifdef SWAY
      world.xyz += sway(world.xyz);
    #endif
    vSurfacePos = position;
    vSurfaceNormal = normal;
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
  uniform float uFill;
  uniform float uSpec;
  uniform float uShine;
  uniform vec3 uHighlight;
  uniform float uHighlightAmt;
  uniform float uAlpha;
  uniform vec3 uFog;
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uVibrance;
  uniform vec3 uFocus;
  uniform highp sampler2DShadow uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowOn;
  uniform float uShadowTexel;
  uniform sampler2D uHeightMap;
  uniform mat4 uHeightMatrix;
  uniform vec3 uHeightScale;
  uniform float uHeightOn;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vSurfacePos;
  varying vec3 vSurfaceNormal;
  uniform float uFogScale;
  #if defined(FINISH) && (FINISH == 11 || FINISH == 15 || FINISH == 18)
    varying vec2 vUv;
  #endif
  ${shared}
  ${materialDetailGlsl}
  ${fogGlsl}

  // Lighting happens in linear light; the pencil work on top of it in the page's sRGB.
  vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

  const vec3 SUN = vec3(1.0, 0.86, 0.68) * 0.86;
  const vec3 SKY = vec3(0.6, 0.64, 0.72);
  const vec3 BOUNCE = vec3(0.46, 0.42, 0.37);

  // 1 well inside a map's picture (0..1), easing to 0 at its edge. Past the edge a map only repeats its border,
  // which would smear whatever stands there into long straight stripes across the countryside.
  float inPicture(vec2 uv) {
    vec2 e = smoothstep(0.0, 0.06, uv) * smoothstep(0.0, 0.06, 1.0 - uv);
    return e.x * e.y;
  }

  // How much of the sun reaches here (1 in sunlight): a few soft taps of the sun's shadow map.
  float sunlit(vec3 pos, vec3 n, float ndl) {
    if (uShadowOn < 0.5 || ndl <= 0.0) return 1.0;
    vec4 sc = uShadowMatrix * vec4(pos + n * 0.03, 1.0);
    vec3 c = sc.xyz / sc.w;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float z = c.z - 0.0003;
    float r = uShadowTexel * 1.6;
    float s = texture(uShadowMap, vec3(c.xy, z)) * 2.0;
    s += texture(uShadowMap, vec3(c.xy + vec2(-r, -r * 0.4), z));
    s += texture(uShadowMap, vec3(c.xy + vec2(r * 0.4, -r), z));
    s += texture(uShadowMap, vec3(c.xy + vec2(r, r * 0.4), z));
    s += texture(uShadowMap, vec3(c.xy + vec2(-r * 0.4, r), z));
    // thinning away toward the edge of the sun's picture rather than stopping on a straight line
    return mix(1.0, s / 6.0, inPicture(c.xy));
  }

  // Contact shade on upward surfaces from whatever stands close by or overhead (walls, furniture, people, trees),
  // read from a height map of the scene drawn from straight above. 0 is open sky, 1 fully tucked in.
  float tucked(vec3 pos, vec3 n) {
    if (uHeightOn < 0.5 || n.y < 0.6) return 0.0;
    vec2 uv = (uHeightMatrix * vec4(pos, 1.0)).xy;
    float inside = inPicture(uv);
    if (inside <= 0.0) return 0.0;
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + 0.4;
      bool inner = (i - (i / 2) * 2) == 0;
      vec2 o = vec2(cos(a), -sin(a)) * (inner ? 0.14 : 0.36);
      float h = texture(uHeightMap, uv + o * uHeightScale.yz).r * uHeightScale.x;
      occ += smoothstep(0.03, 0.45, h - pos.y) * (inner ? 0.15 : 0.1);
    }
    float over = texture(uHeightMap, uv).r * uHeightScale.x - pos.y;
    occ += smoothstep(0.05, 0.3, over) * 0.45;
    return clamp(occ, 0.0, 1.0) * inside;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 shapeNormal = n;
    vec3 an = abs(n);
    // Item-local coordinates follow furniture and walking characters, even while moved or rotated.
    vec3 surface = vSurfacePos;
    vec3 tn = normalize(vSurfaceNormal);
    vec3 ta = abs(tn);
    vec2 p = ta.y > ta.x && ta.y > ta.z ? surface.xz : (ta.x > ta.z ? surface.zy : surface.xy);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    vec3 tone = uTone * (0.96 + noise(surface * 3.2) * 0.08);
    float lines = 0.0;
    float relief = 0.0;
    // the normal the light glints off (water ripples bend it), and how glossy the surface is
    vec3 sn = n;
    float spec = uSpec;
    float shine = uShine;
    vec3 glow = vec3(0.0);
    #ifdef FINISH
      vec2 side = normalize(vec2(-tn.z, tn.x) + vec2(1e-4, 0.0));
      vec2 fp = ta.y > 0.72 ? surface.xz : vec2(dot(surface.xz, side), surface.y);
      float tv = 0.0;
      #if FINISH == 1
        // plaster: soft cloudy patches, the odd hairline crack
        tv = (noise(surface * 0.6) - 0.5) * 0.075 + (noise(surface * 2.7) - 0.5) * 0.045;
        relief = noise(surface * 14.0) * 0.0007 * detailAt(fp, 14.0);
        lines = strokes(fp * vec2(0.35, 0.2), 1.1, 0.6, 0.04, vec3(4.0, 8.0, 0.0)) * step(0.86, noise(vWorldPos * 0.5 + 2.0)) * 0.3;
      #elif FINISH == 2
        // wood: boards with seams, staggered butt joints and a restrained grain
        float bw = 0.18;
        float row = floor(fp.y / bw);
        float seam = fineLine(fp.y / bw, 0.018);
        float blen = 1.4 + hash(vec3(row, 3.0, 1.0)) * 0.8;
        float butt = fineLine(fp.x / blen + hash(vec3(row, 9.0, 2.0)), 0.007);
        float grain2 = max(0.0, timberGrain(fp));
        lines = max(seam * 0.5, butt * 0.4) + grain2 * 0.24;
        relief = grain2 * 0.00025;
        tv = (hash(vec3(row, floor(fp.x / blen + hash(vec3(row, 9.0, 2.0))), 3.0)) - 0.5) * 0.1;
      #elif FINISH == 3
        // stone: ashlar courses of uneven blocks
        float ch = 0.34;
        float row = floor(fp.y / ch);
        float len = 0.5 + hash(vec3(row, 5.0, 1.0)) * 0.45;
        float cx = (fp.x + hash(vec3(row, 2.0, 7.0)) * 3.0) / len;
        float mh = fineLine(fp.y / ch, 0.027);
        float mv = fineLine(cx, 0.025);
        lines = max(mh, mv) * 0.7;
        tv = (hash(vec3(row, floor(cx), 9.0)) - 0.5) * 0.12 + (noise(vWorldPos * 2.2) - 0.5) * 0.04;
      #elif FINISH == 4
        // brick: running bond
        vec2 bq = vec2(fp.x / 0.42, fp.y / 0.18);
        float br = floor(bq.y);
        bq.x += mod(br, 2.0) * 0.5;
        float mh = fineLine(bq.y, 0.032);
        float mv = fineLine(bq.x, 0.024);
        lines = max(mh, mv) * 0.55;
        tv = (hash(vec3(floor(bq), 4.0)) - 0.5) * 0.14;
      #elif FINISH == 5
        // checker tile: square tiles with grout, every other one a shade darker, a glazed sheen
        vec2 tq = fp / 0.33;
        float grout = max(fineLine(tq.x, 0.025), fineLine(tq.y, 0.025));
        lines = grout * 0.45;
        float alt = mod(floor(tq.x) + floor(tq.y), 2.0);
        tv = -alt * 0.13 + (hash(vec3(floor(tq), 3.0)) - 0.5) * 0.04;
        spec *= 1.0 - grout;
      #elif FINISH == 6
        // setts: small squared stones in a running bond
        vec2 bq = vec2(fp.x / 0.3, fp.y / 0.22);
        float br = floor(bq.y);
        bq.x += mod(br, 2.0) * 0.5 + hash(vec3(br, 3.0, 1.0)) * 0.2;
        float mh = fineLine(bq.y, 0.04);
        float mv = fineLine(bq.x, 0.035);
        lines = max(mh, mv) * 0.45;
        float hv = hash(vec3(floor(bq), 2.0));
        tv = (hv - 0.5) * 0.1 - step(0.93, hv) * 0.08;
      #elif FINISH == 7
        // concrete: speckled grain and faint control joints
        float joint = 1.0 - smoothstep(0.0, 0.015, 0.5 - max(abs(fract(fp.x / 2.0) - 0.5), abs(fract(fp.y / 2.0) - 0.5)));
        lines = joint * 0.3;
        tv = (noise(vWorldPos * 0.7) - 0.5) * 0.06 + (hash(floor(vWorldPos * 16.0)) - 0.5) * 0.025;
      #elif FINISH == 8
        // carpet: soft pile with short scattered strokes
        tv = (noise(vWorldPos * 3.0) - 0.5) * 0.06 + (noise(vWorldPos * 14.0) - 0.5) * 0.04;
        float pile = clothWeave(fp * 0.75);
        lines = pile * 0.32;
        relief = pile * 0.001;
      #elif FINISH == 9
        // Woven upholstery: readable yarns near the camera and a soft linen variation farther away.
        float yarn = clothWeave(fp);
        lines = yarn * 0.4;
        relief = yarn * 0.00025;
        tv = (noise(surface * 5.0) - 0.5) * 0.11 + (noise(surface * 18.0) - 0.5) * 0.025 * detailAt(fp, 18.0);
      #elif FINISH == 10
        #ifdef NATURAL
          float field = noise(surface * 0.13);
          float turf = noise(surface * 1.8);
          tone = mix(uTone * vec3(0.75, 0.83, 0.67), uTone * vec3(1.08, 1.04, 0.84), field);
          tv = (turf - 0.5) * 0.14 + (noise(surface * 24.0) - 0.5) * 0.09 * detailAt(fp, 24.0);
        #else
        // lawn: broad, slow drifts between deeper and fresher greens, and a scatter of short blades
        float n0 = noise(vWorldPos * 0.03 + 3.0);
        float n1 = noise(vWorldPos * 0.12);
        float n2 = noise(vWorldPos * 0.8);
        vec3 grass = mix(vec3(0.34, 0.5, 0.29), vec3(0.45, 0.6, 0.34), smoothstep(0.25, 0.75, n1));
        grass = mix(grass, vec3(0.53, 0.64, 0.37), smoothstep(0.55, 0.85, n0) * 0.5);
        tone = grass * (0.95 + 0.08 * n2);
        float blades = strokes(p * vec2(1.0, 1.6), 1.2 + (n1 - 0.5) * 0.9, 3.1, 0.06, vec3(2.0, 6.0, 0.0));
        lines = blades * smoothstep(0.45, 0.75, noise(vWorldPos * 0.35 + 7.0)) * 0.16;
        #endif
      #elif FINISH == 11 || FINISH == 15
        // water: deeper and bluer toward the middle, ripples drifting across, the sky and sun caught on top
        vec2 q = vWorldPos.xz;
        #if FINISH == 15
          // a lake: broader, slower ripples
          q *= 0.35;
        #endif
        float t = uTime;
        vec3 wq = vec3(q * 1.7 + vec2(t * 0.22, t * 0.15), t * 0.18);
        float e = 0.08;
        float wx = noise(wq + vec3(e, 0.0, 0.0)) - noise(wq - vec3(e, 0.0, 0.0));
        float wz = noise(wq + vec3(0.0, e, 0.0)) - noise(wq - vec3(0.0, e, 0.0));
        vec3 wq2 = vec3(q * 4.2 - vec2(t * 0.3, -t * 0.24), 5.0 + t * 0.25);
        wx += (noise(wq2 + vec3(e, 0.0, 0.0)) - noise(wq2 - vec3(e, 0.0, 0.0))) * 0.5;
        wz += (noise(wq2 + vec3(0.0, e, 0.0)) - noise(wq2 - vec3(0.0, e, 0.0))) * 0.5;
        sn = normalize(n + vec3(-wx, 0.0, -wz) * 1.4);
        #if FINISH == 15
          // the lake's uv.x runs from 0 at the shore to 1 in the middle
          float deep = smoothstep(0.0, 0.55, vUv.x);
        #else
          vec2 edge = min(vUv, 1.0 - vUv);
          float deep = smoothstep(0.0, 0.32, min(edge.x * 2.0, edge.y));
        #endif
        tone = mix(tone * vec3(1.12, 1.1, 1.04) + 0.05, tone * vec3(0.62, 0.8, 0.95), deep);
        // bright wavering lines where the ripples gather the light on the bottom
        float caustic = 1.0 - smoothstep(0.0, 0.08, abs(noise(vec3(q * 2.3, t * 0.35)) - 0.5));
        tv = caustic * 0.14 * (1.0 - deep * 0.5);
        // the sky seen in the surface, stronger at a glance
        float fres = pow(1.0 - max(dot(sn, viewDir), 0.0), 3.0);
        glow = vec3(0.86, 0.94, 1.0) * (0.12 + fres * 0.5);
        #if defined(NATURAL) && FINISH == 15
          // Restrained wind-rippled lake, a sky tint at grazing angles and clear shallows.
          tv *= 0.22;
          tone = mix(tone, vec3(0.55, 0.68, 0.76), 0.12 + fres * 0.48);
          glow *= 0.65;
        #endif
      ${itemFinishesGlsl}
      #elif FINISH == 17
        // shingles: level courses stepping down the slope, tabs staggered course to course, a little shadow
        // under each course's lower edge
        float along = an.x > an.z ? vWorldPos.z : vWorldPos.x;
        float cy = vWorldPos.y / 0.13;
        float course = floor(cy);
        float f = fract(cy);
        float tq = along / 0.34 + mod(course, 2.0) * 0.5 + hash(vec3(course, 1.0, 7.0)) * 0.2;
        float edge = 1.0 - smoothstep(0.02, 0.09, min(f, 1.0 - f));
        float seam = (1.0 - smoothstep(0.0, 0.04, abs(fract(tq) - 0.5) - 0.45)) * step(0.12, f);
        lines = max(edge * 0.5, seam * 0.35);
        tv = (hash(vec3(course, floor(tq), 6.0)) - 0.5) * 0.12 - smoothstep(0.55, 1.0, f) * 0.07;
      #elif FINISH == 16
        // mountains: forest on the lower slopes, blue-grey rock with faint strata, snow on the high flatter parts
        float m1 = noise(vWorldPos * 0.05);
        float m2 = noise(vWorldPos * 0.21 + 4.0);
        float trees = 1.0 - smoothstep(10.0, 18.0, vWorldPos.y + (m1 - 0.5) * 12.0);
        tone = mix(tone * (0.9 + 0.2 * m2), vec3(0.24, 0.42, 0.3), trees * 0.9);
        float snow = smoothstep(29.0, 34.0, vWorldPos.y + (m1 - 0.5) * 16.0 + (m2 - 0.5) * 5.0) * smoothstep(0.25, 0.5, n.y);
        tone = mix(tone, vec3(0.97, 0.97, 1.0), snow);
        lines = strokes(vec2(fp.x * 0.05, vWorldPos.y * 0.12), 0.25, 1.0, 0.08, vec3(5.0, 2.0, 0.0)) * (1.0 - snow) * (1.0 - trees) * 0.2;
      #endif
      tone *= 1.0 + tv;
    #endif
    // @build-material-detail
    #if defined(FINISH) && (FINISH == 1 || FINISH == 2 || FINISH == 8 || FINISH == 9 || FINISH == 18 || FINISH == 19 || FINISH == 20 || FINISH == 21 || FINISH == 23 || FINISH == 24 || FINISH == 25 || FINISH == 26)
      // Compile-time choice: derivatives must also run between individual yarns/pores.
      n = texturedNormal(n, vWorldPos, relief);
      sn = n;
    #endif
    #ifdef NATURAL
      vec3 base = tone;
    #else
      vec3 base = mix(uPaper, tone, 0.96);
    #endif

    // Light: a warm sun with soft shadows over a cool sky, a little warm bounce from below, and contact shade.
    float ndl = dot(n, uLightDir);
    float sun = max(ndl, 0.0) * sunlit(vWorldPos, n, ndl);
    float occ = tucked(vWorldPos, n);
    // where walls and furniture meet the floor, a soft band low down
    occ = max(occ, (1.0 - smoothstep(0.0, 0.25, vWorldPos.y)) * (1.0 - an.y) * 0.45);
    vec3 fill = mix(BOUNCE, SKY, 0.5 + 0.5 * n.y) * (1.0 - occ * 0.55);
    // uFill: soft light from the room itself, for surfaces only ever seen from inside (ceilings)
    vec3 irradiance = fill + SUN * sun * (1.0 - occ * 0.35) + vec3(1.0, 0.95, 0.88) * uFill;
    #if defined(FINISH) && FINISH == 26
      // Light transmitted through the thin leaves softens the dark side of a crown.
      irradiance += SUN * max(-ndl, 0.0) * 0.12;
    #endif
    vec3 lit = toLinear(base) * irradiance;
    // Gloss: a tight glint for polished things plus a broad soft lobe around it, which is all the bloom there is.
    vec3 halfway = normalize(uLightDir + viewDir);
    float nh = max(dot(sn, halfway), 0.0);
    float glint = (pow(nh, shine) + pow(nh, shine * 0.18) * 0.12) * spec * step(0.0, ndl) * (sun > 0.0 ? sun / max(ndl, 1e-3) : 0.0);
    lit += SUN * glint * 1.6 + toLinear(glow) * spec * 0.6;
    // A soft shoulder keeps bright things from flattening to white without dulling the rest.
    float peak = max(lit.r, max(lit.g, lit.b));
    if (peak > 0.78) lit *= (0.78 + (1.0 - 0.78) * (1.0 - exp(-(peak - 0.78) / (1.0 - 0.78)))) / peak;
    vec3 col = toSrgb(lit);

    // Pencil: crosshatching builds up only in real shade, strokes of the finish, a graphite rim on curves.
    #ifndef NATURAL
    float lum = dot(irradiance, vec3(0.3, 0.59, 0.11));
    float dark = clamp(1.0 - lum, 0.0, 1.0) * 0.45 + occ * 0.12;
    float density = uDensity;
    float h = 0.0;
    h += strokes(p, 0.785, density, 0.13, vec3(1.3, 4.1, 0.0)) * smoothstep(0.17, 0.23, dark);
    h += strokes(p, -0.785, density * 1.1, 0.12, vec3(7.7, 2.9, 0.0)) * smoothstep(0.27, 0.33, dark);
    h += strokes(p, 0.05, density * 1.25, 0.11, vec3(3.1, 9.4, 0.0)) * smoothstep(0.36, 0.42, dark);
    h = clamp(h, 0.0, 1.0);
    // Far away, strokes thinner than a pixel shimmer; blend them into a flat graphite tone instead.
    float fw = length(fwidth(p)) * density;
    float aa = 1.0 - smoothstep(0.2, 0.7, fw);
    h = mix(smoothstep(0.17, 0.5, dark) * 0.3, h, aa);
    float lfw = length(fwidth(p)) * 6.0;
    float marks = lines * (1.0 - smoothstep(0.3, 1.0, lfw));

    // Microtexture affects light, not the drawn contour of the underlying shape.
    float facing = abs(dot(shapeNormal, viewDir));
    float rimEdge = 0.22 + noise(vWorldPos * 4.0) * 0.12;
    float curve = smoothstep(0.004, 0.03, length(fwidth(shapeNormal)));
    float rim = (1.0 - smoothstep(rimEdge, rimEdge + 0.08, facing)) * uRim * curve;

    float grainFade = detailAt(p, 38.0);
    float grain = (noise(surface * 38.0) - 0.5) * 0.024 * grainFade + (noise(surface * 9.0) - 0.5) * 0.016 * detailAt(p, 9.0);
    col += grain;
    // shading strokes take on a cool graphite, the finish's own lines a darker version of the surface
    col = mix(col, uInk * vec3(0.94, 0.98, 1.08), h * 0.12);
    col = mix(col, col * 0.62, marks * 0.55);
    col = mix(col, uInk, rim * 0.7);
    #else
      // Surface marks are material relief, with no graphite contours or crosshatching.
      col *= 1.0 - lines * 0.16;
    #endif

    // Grading: lift the softer colours (not the already-bold ones), keep shadows slightly cool, and let
    // everything beyond the lot settle back so the house stays the focus.
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float chroma = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
    float away = smoothstep(uFocus.z, uFocus.z + 28.0, length(vWorldPos.xz - uFocus.xy));
    #if defined(FINISH) && FINISH == 16
      // mountains keep some colour, or they'd fade to grey cardboard
      away *= 0.4;
    #endif
    #ifdef NATURAL
      // Keep the lively outdoor palette even beyond the house; haze alone establishes depth.
      away *= 0.2;
      col = mix(vec3(luma), col, 1.1);
    #endif
    col = mix(vec3(luma), col, 1.0 + uVibrance * (1.0 - chroma * 1.6) * (1.0 - away));
    col += vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.05, 0.5, luma));
    col = mix(col, mix(vec3(luma), col, 0.7) * 0.94 + uFog * 0.06, away * 0.8);
    col = clamp(col, 0.0, 1.0);
    col = mix(col, uHighlight, uHighlightAmt);
    col *= uTint;
    col = mix(col, uFog, fogAt(length(cameraPosition - vWorldPos)) * uFogScale);
    gl_FragColor = vec4(col, uAlpha);
  }
`;

const FINISHES = { plaster: 1, wood: 2, stone: 3, brick: 4, checker: 5, setts: 6, concrete: 7, carpet: 8, fabric: 9, lawn: 10, water: 11, metal: 12, glass: 13, paint: 14, lake: 15, mountain: 16, shingle: 17, timber: 18, ceramic: 19, mineral: 20, foliage: 21, paper: 22, rubber: 23, clay: 24, bark: 25, canopy: 26, groundcover: 27, earth: 28 } as const;
export type Finish = keyof typeof FINISHES;

/**
 * How glossy each finish is: [strength, tightness] of the sun's glint. Plaster, fabric and the rest stay matte;
 * wood has a soft sheen, glaze and paint a little more, metal and glass a small sharp highlight.
 */
const GLOSS: Partial<Record<Finish | "clear", [number, number]>> = {
  wood: [0.12, 22],
  timber: [0.13, 26],
  ceramic: [0.32, 70],
  mineral: [0.16, 32],
  shingle: [0.06, 16],
  checker: [0.3, 60],
  water: [1, 150],
  lake: [1, 150],
  metal: [0.45, 48],
  glass: [0.6, 110],
  paint: [0.28, 40],
  clear: [0.6, 110],
};

export interface PencilOptions {
  /** Continuous outdoor shading, without drawn contours or crosshatching. */
  natural?: boolean;
  density?: number;
  rim?: boolean;
  finish?: Finish;
  /** Drawn see-through, tinted: furniture you're carrying before you drop it. */
  ghost?: "ok" | "bad";
  /** See-through (glass, water); 1 is solid. */
  alpha?: number;
  /** How much distance haze it takes; far scenery like mountains takes less so it still reads. */
  fog?: number;
  /** Extra soft light from all round, for surfaces the sun and sky never reach (a ceiling). */
  fill?: number;
  /** Sways in the breeze (grass, reeds, flowers): how far, per metre of height squared. Its outlines should be
   * drawn with the same `sway` (Kit does this). */
  sway?: number;
}

const cache = new Map<string, THREE.ShaderMaterial>();

/** Shared pencil material. Calls with the same arguments return the same instance. */
export function pencilMaterial(tone: string = PAPER, opts: PencilOptions = {}) {
  const key = `${tone}|${opts.density ?? 6}|${opts.rim === false ? 0 : 1}|${opts.finish ?? ""}|${opts.ghost ?? ""}|${opts.alpha ?? 1}|${opts.fog ?? 1}|${opts.fill ?? 0}|${opts.sway ?? 0}|${opts.natural ? 1 : 0}`;
  let m = cache.get(key);
  if (!m) {
    const ghost = opts.ghost;
    const [spec, shine] = GLOSS[opts.finish ?? ((opts.alpha ?? 1) < 1 ? "clear" : "plaster")] ?? [0, 1];
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
        uFill: { value: opts.fill ?? 0 },
        uSpec: { value: opts.natural && opts.finish === "lake" ? spec * 0.65 : spec },
        uShine: { value: shine },
        uHighlight: { value: srgb(ghost === "bad" ? "#e0675a" : "#9ccf8a") },
        uHighlightAmt: { value: ghost ? 0.3 : 0 },
        uAlpha: { value: (ghost ? 0.72 : 1) * (opts.alpha ?? 1) },
        uFog: fogUniform,
        uFogScale: { value: opts.fog ?? 1 },
        uTint: lighting.tint,
        uTime: lighting.time,
        uVibrance: lighting.vibrance,
        uFocus: lighting.focus,
        uShadowMap: lighting.shadowMap,
        uShadowMatrix: lighting.shadowMatrix,
        uShadowOn: lighting.shadowOn,
        uShadowTexel: lighting.shadowTexel,
        uHeightMap: lighting.heightMap,
        uHeightMatrix: lighting.heightMatrix,
        uHeightScale: lighting.heightScale,
        uHeightOn: lighting.heightOn,
        uSway: { value: opts.sway ?? 0 },
        uWind: lighting.wind,
      },
      transparent: Boolean(ghost) || (opts.alpha ?? 1) < 1,
      depthWrite: !ghost && (opts.alpha ?? 1) >= 1,
      defines: { ...(opts.natural ? { NATURAL: 1 } : {}), ...(opts.finish ? { FINISH: FINISHES[opts.finish] } : {}), ...(opts.sway ? { SWAY: 1 } : {}) },
    });
    m.userData.sway = opts.sway ?? 0;
    m.userData.finish = opts.finish;
    m.userData.natural = Boolean(opts.natural);
    cache.set(key, m);
  }
  return m;
}

const outlineVertex = /* glsl */ `
  #ifdef SWAY
    ${swayGlsl}
  #endif
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
    float jitter = 0.85 + 0.3 * h(floor(position * 7.0 + 0.5));
    #ifdef MERGED
      vec3 dir = normalize(mix(normal, normalize(position - aCenter + 1e-5), uRadial));
      vec3 pushed = position + dir * uThickness * jitter;
    #else
      vec3 dir = normalize(mix(normal, normalize(position + 1e-5), uRadial));
      vec3 pushed = position + dir * uThickness * jitter / s;
    #endif
    vec4 world = m * vec4(pushed, 1.0);
    #ifdef SWAY
      world.xyz += sway(world.xyz);
    #endif
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
export function outlineMaterial(thickness = 0.02, radial = true, merged = false, ghost = false, sway = 0) {
  const key = `${thickness}|${radial}|${merged}|${ghost}|${sway}`;
  let m = outlineCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      uniforms: {
        uThickness: { value: thickness },
        uRadial: { value: radial ? 1 : 0 },
        uInk: { value: srgb(INK) },
        uFog: fogUniform,
        uAlpha: { value: ghost ? 0.5 : 1 },
        uTime: lighting.time,
        uSway: { value: sway },
        uWind: lighting.wind,
      },
      side: THREE.BackSide,
      transparent: ghost,
      depthWrite: !ghost,
      defines: { ...(merged ? { MERGED: 1 } : {}), ...(sway ? { SWAY: 1 } : {}) },
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

/**
 * Soft contact shadow: a rounded patch of cool shade, lightly hatched, that fades toward its edge. With real
 * shadows on (`lighting.contact` < 1) it steps back to a faint touch, since the light already grounds things.
 */
const shadowFragment = /* glsl */ `
  uniform vec3 uInk;
  uniform float uStrength;
  uniform float uContact;
  uniform vec2 uSize;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  ${shared}
  void main() {
    // distance to a rounded rectangle, in metres, so the falloff is the same width for any size
    vec2 q = abs(vUv - 0.5) * uSize - (uSize * 0.5 - 0.25);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float fall = 1.0 - smoothstep(-0.16, 0.28, d);
    fall *= fall;
    float lines = strokes(vWorldPos.xz, 0.785, 11.0, 0.22, vec3(4.0, 1.0, 0.0)) * step(0.5, fall);
    gl_FragColor = vec4(uInk * vec3(0.85, 0.92, 1.1), (lines * 0.25 + 0.75) * fall * uStrength * uContact);
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
    uniforms: { uInk: { value: srgb(INK) }, uStrength: { value: strength }, uContact: lighting.contact, uSize: { value: new THREE.Vector2(w, d) } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  shadowCache.set(key, m);
  return m;
}
