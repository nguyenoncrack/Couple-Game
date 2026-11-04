/** Analytic surface detail: no image downloads, extra meshes or per-frame texture uploads. */
export const materialDetailGlsl = /* glsl */ `
  // Frequencies smaller than a pixel fade to their average instead of sparkling as the camera moves.
  float detailAt(vec2 q, float frequency) {
    return 1.0 - smoothstep(0.3, 0.85, length(fwidth(q)) * frequency);
  }
  float fineLine(float q, float width) {
    float pixel = max(fwidth(q), 0.001);
    float d = abs(fract(q + 0.5) - 0.5);
    return (1.0 - smoothstep(width - pixel, width + pixel, d)) * (1.0 - smoothstep(0.35, 0.85, pixel));
  }
  float clothWeave(vec2 q) {
    float a = fineLine(q.x * 46.0, 0.15);
    float b = fineLine(q.y * 49.0, 0.15);
    float slub = noise(vec3(q * vec2(7.0, 26.0), 3.0));
    return max(a, b) * (0.65 + slub * 0.35);
  }
  float timberGrain(vec2 q) {
    float bend = noise(vec3(q * vec2(0.7, 4.0), 2.0));
    vec2 cell = floor(q / vec2(0.85, 0.32));
    vec2 at = (fract(q / vec2(0.85, 0.32)) - 0.5) * vec2(0.85, 0.32);
    float knot = exp(-dot(at * vec2(8.0, 28.0), at * vec2(8.0, 28.0))) * step(0.62, hash(vec3(cell, 4.0)));
    float rings = q.y * 32.0 + bend * 3.2 + sin(q.x * 2.2 + q.y * 5.0) * 0.18 + knot * 1.8;
    float fine = fineLine(rings, 0.09);
    float broad = sin(q.y * 56.0 + bend * 5.0) * detailAt(q, 13.0);
    return fine * 0.68 + broad * 0.17 + knot * 0.55;
  }
  // Screen-space height derivatives give microscopic relief without changing silhouettes or hitboxes.
  vec3 texturedNormal(vec3 n, vec3 world, float height) {
    vec3 dx = dFdx(world), dy = dFdy(world);
    vec3 rx = cross(dy, n), ry = cross(n, dx);
    float determinant = dot(dx, rx);
    vec3 gradient = sign(determinant) * (dFdx(height) * rx + dFdy(height) * ry);
    return normalize(max(abs(determinant), 1e-8) * n - gradient);
  }
`;

/** Additional item finishes; the original architecture finish IDs remain stable. */
export const itemFinishesGlsl = /* glsl */ `
      #elif FINISH == 12
        // Brushed metal: satin direction, tiny machining marks, a broken rather than plastic-like glint.
        float brushed = fineLine(fp.y * 180.0 + sin(fp.x * 7.0) * 0.12, 0.08);
        lines = brushed * 0.12;
        tv = (noise(vec3(fp * vec2(1.5, 55.0), 8.0)) - 0.5) * 0.045 * detailAt(fp, 30.0);
        spec *= 0.82 + 0.18 * noise(surface * 5.0);
      #elif FINISH == 13
        // Clean glass stays readable; only a broad, faint reflection streak crosses it.
        tv = sin(fp.x * 3.0 + fp.y * 1.5) * 0.018;
      #elif FINISH == 14
        // Painted enamel: soft pigment variation and a restrained orange-peel sheen.
        tv = (noise(surface * 3.0) - 0.5) * 0.035;
        spec *= 0.88 + 0.12 * noise(surface * 24.0) * detailAt(fp, 24.0);
      #elif FINISH == 18
        // Continuous furniture timber, without the floor's board joints.
        vec2 grainP = vUv;
        float woodGrain = max(0.0, timberGrain(grainP));
        lines = woodGrain * 0.65;
        relief = woodGrain * 0.00045;
        tv = (noise(vec3(grainP * vec2(0.6, 10.0), 1.0)) - 0.5) * 0.17;
        spec *= 0.8 + 0.2 * noise(surface * 3.0);
      #elif FINISH == 19
        // Ceramic glaze: faint pooled colour over a smooth, softly reflective surface.
        float pool = noise(surface * 6.0);
        tv = (pool - 0.5) * 0.045;
        relief = pool * 0.0001;
        spec *= 0.86 + pool * 0.14;
      #elif FINISH == 20
        // Solid stone slabs: mineral flecks and gently meandering veins, never masonry courses.
        float cloud = noise(surface * 3.1);
        float vein = 1.0 - smoothstep(0.015, 0.055, abs(noise(surface * 1.4 + cloud * 0.6) - 0.48));
        lines = vein * 0.18;
        relief = cloud * 0.001;
        tv = (cloud - 0.5) * 0.13 + (noise(surface * 33.0) - 0.5) * 0.08 * detailAt(fp, 33.0);
      #elif FINISH == 21
        // Leaves: mottled green and fine vein-like marks rather than a single flat colour.
        float mottled = noise(surface * 16.0);
        tv = (mottled - 0.5) * 0.15;
        relief = mottled * 0.0005;
        lines = fineLine(fp.x * 27.0 + sin(fp.y * 9.0) * 0.4, 0.045) * 0.1;
      #elif FINISH == 22
        // Paper/card: fine fibres, matte and lightly uneven ink coverage.
        lines = fineLine(fp.y * 110.0 + noise(surface * 5.0), 0.055) * 0.06;
        tv = (noise(surface * 11.0) - 0.5) * 0.055;
      #elif FINISH == 23
        // Rubber: tight, matte stipple. Keep it clean rather than looking like chipped stone.
        tv = (noise(surface * 55.0) - 0.5) * 0.085 * detailAt(fp, 55.0);
        relief = tv * 0.003;
      #elif FINISH == 24
        // Unglazed terracotta: small pores and broad clay variation.
        tv = (noise(surface * 5.0) - 0.5) * 0.12 + (noise(surface * 42.0) - 0.5) * 0.09 * detailAt(fp, 42.0);
        relief = tv * 0.006;
        lines = fineLine(fp.y * 85.0 + sin(fp.x * 4.0) * 0.2, 0.035) * 0.055;
`;
