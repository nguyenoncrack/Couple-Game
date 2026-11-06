/** Extra building finishes share metre-space coordinates with the original materials. */
export const expansionSurfaceGlsl = /* glsl */ `
  #elif BUILD_SURFACE == 15
    // Botanical block print: two diagonal leaves and a coral bud in each 40 cm repeat.
    vec2 printCell = bq / 0.4;
    vec2 uv = fract(printCell) - 0.5;
    float stem = 1.0 - smoothstep(0.009, 0.022, abs(uv.x - sin(uv.y * 7.0) * 0.07));
    vec2 leafA = mat2(0.8, -0.6, 0.6, 0.8) * (uv - vec2(0.12, 0.06));
    vec2 leafB = mat2(0.8, 0.6, -0.6, 0.8) * (uv - vec2(-0.11, -0.17));
    float leaf = max(1.0 - smoothstep(0.8, 1.0, length(leafA / vec2(0.16, 0.065))), 1.0 - smoothstep(0.8, 1.0, length(leafB / vec2(0.14, 0.06))));
    float bud = 1.0 - smoothstep(0.04, 0.06, length(uv - vec2(0.02, 0.31)));
    tone = mix(tone, vec3(0.28, 0.51, 0.37), max(leaf, stem * 0.65) * 0.8);
    tone = mix(tone, vec3(0.85, 0.43, 0.35), bud * 0.9);
    relief = noise(surface * 35.0) * 0.0003 * detailAt(bq, 35.0);
  #elif BUILD_SURFACE == 16
    float upper = smoothstep(1.0, 1.018, bq.y);
    vec2 panel = vec2(fract(bq.x / 0.48), fract(bq.y / 0.93));
    float inset = step(0.12, panel.x) * step(panel.x, 0.88) * step(0.13, panel.y) * step(panel.y, 0.9);
    float molding = max(fineLine((panel.x - 0.12) / 0.76, 0.017), fineLine((panel.y - 0.13) / 0.77, 0.017));
    float rail = 1.0 - smoothstep(0.025, 0.037, abs(bq.y - 0.99));
    tone = mix(tone * (1.0 - inset * 0.09 + molding * inset * 0.12), vec3(0.93, 0.9, 0.8), upper);
    tone *= 1.0 - rail * 0.15;
    relief = (inset * 0.002 + rail * 0.003) * (1.0 - upper);
    spec *= 1.0 - upper * 0.8;
  #elif BUILD_SURFACE == 17
    float slat = fract(bq.x / 0.04);
    float slatAA = min(0.2, fwidth(bq.x / 0.04));
    float backing = 1.0 - smoothstep(0.15 - slatAA, 0.21 + slatAA, slat) + smoothstep(0.79 - slatAA, 0.85 + slatAA, slat);
    tone = mix(tone, vec3(0.14, 0.18, 0.17), clamp(backing, 0.0, 1.0) * 0.92);
    lines = max(0.0, timberGrain(vec2(bq.y, bq.x))) * 0.45;
    pigment = (hash(vec3(floor(bq.x / 0.04), 1.0, 5.0)) - 0.5) * 0.14;
    relief = (1.0 - clamp(backing, 0.0, 1.0)) * 0.0006 * detailAt(bq, 25.0);
  #elif BUILD_SURFACE == 18
    joints = fineLine(bq.y / 0.16, 0.012);
    lines = max(0.0, timberGrain(bq)) * 0.22;
    pigment = (hash(vec3(floor(bq.y / 0.16), 4.0, 2.0)) - 0.5) * 0.08;
    relief = joints * -0.001;
  #elif BUILD_SURFACE == 19
    // Offset mineral fragments: a jittered cell and angled polygon cut for each chip.
    vec2 chip = bq / 0.085;
    vec2 cell = floor(chip);
    vec2 jitter = vec2(hash(vec3(cell, 9.0)), hash(vec3(cell, 10.0))) * 0.32 - 0.16;
    vec2 uv = fract(chip) - 0.5 - jitter;
    float seed = hash(vec3(cell, 8.0));
    float angle = seed * 6.28318;
    vec2 cut = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * uv;
    float extent = 0.13 + seed * 0.2;
    float dist = max(abs(cut.x) * 0.8 + abs(cut.y) * 0.7, abs(cut.y));
    float chipAA = max(0.018, fwidth(dist));
    float fragment = (1.0 - smoothstep(extent - chipAA, extent + chipAA, dist)) * step(0.16, seed);
    vec3 mineral = seed < 0.34 ? vec3(0.76, 0.38, 0.29) : seed < 0.67 ? vec3(0.22, 0.48, 0.49) : vec3(0.77, 0.6, 0.3);
    tone = mix(tone, mineral, fragment * 0.85 * detailAt(bq, 10.0));
    pigment = (noise(surface * 8.0) - 0.5) * 0.035;
  #elif BUILD_SURFACE == 20
    vec2 flag = bq / vec2(0.6, 0.4);
    flag.x += mod(floor(flag.y), 2.0) * 0.5;
    joints = max(fineLine(flag.x, 0.007), fineLine(flag.y, 0.011));
    pigment = (hash(vec3(floor(flag), 9.0)) - 0.5) * 0.23 + (noise(surface * 12.0) - 0.5) * 0.12;
    relief = noise(surface * 19.0) * 0.0018 * detailAt(bq, 19.0);
  #elif BUILD_SURFACE == 21
    // Two interleaved pointy hexagon grids, 26 cm flat-to-flat.
    vec2 hex = bq / 0.15;
    vec2 period = vec2(1.7320508, 3.0);
    vec2 a = mod(hex, period) - period * 0.5;
    vec2 b = mod(hex - period * 0.5, period) - period * 0.5;
    vec2 local = dot(a, a) < dot(b, b) ? a : b;
    vec2 centre = floor((hex - local) * 100.0 + 0.5) / 100.0;
    float edge = max(abs(local.x) * 0.5 + abs(local.y) * 0.8660254, abs(local.x));
    float hexAA = fwidth(edge);
    joints = smoothstep(0.82 - hexAA, 0.85 + hexAA, edge);
    pigment = (hash(vec3(centre, 2.0)) - 0.5) * 0.2 + (noise(surface * 30.0) - 0.5) * 0.06 * detailAt(bq, 30.0);
    relief = noise(surface * 17.0) * 0.0008;
  #elif BUILD_SURFACE == 22
    vec2 tile = bq / 0.4, uv = fract(tile) - 0.5;
    vec2 rotated = vec2(uv.x + uv.y, uv.x - uv.y) * 0.70710678;
    float diamond = abs(rotated.x) + abs(rotated.y);
    float ring = 1.0 - smoothstep(0.022, 0.037, abs(length(uv) - 0.29));
    float star = 1.0 - smoothstep(0.18, 0.2, diamond);
    float petal = (1.0 - smoothstep(0.06, 0.085, min(abs(uv.x), abs(uv.y)))) * (1.0 - smoothstep(0.32, 0.35, max(abs(uv.x), abs(uv.y))));
    tone = mix(tone, vec3(0.18, 0.39, 0.58), max(ring, petal) * (1.0 - star) * 0.9);
    tone = mix(tone, vec3(0.81, 0.61, 0.28), star * 0.85);
    joints = max(fineLine(tile.x, 0.012), fineLine(tile.y, 0.012));
    relief = noise(surface * 24.0) * 0.0004;
`;
