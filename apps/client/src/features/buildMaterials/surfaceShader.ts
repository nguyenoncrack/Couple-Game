import { expansionSurfaceGlsl } from "./expansionShader";

/** All coordinates are metres in the floor's frame, independent of wall runs / tile mesh boundaries. */
export const buildSurfaceGlsl = /* glsl */ `
  vec2 bq = p;
  float joints = 0.0;
  float pigment = 0.0;
  #if BUILD_SURFACE == 1
    pigment = (noise(surface * 2.6) - 0.5) * 0.09;
    relief = noise(surface * 17.0) * 0.0007 * detailAt(bq, 17.0);
  #elif BUILD_SURFACE == 2
    vec2 grain = vec2(bq.y, bq.x);
    joints = fineLine(bq.x / 0.22, 0.018);
    pigment = (noise(vec3(floor(bq.x / 0.22), 3.0, 0.0)) - 0.5) * 0.12;
    lines = max(0.0, timberGrain(grain)) * 0.5;
    relief = lines * 0.0005;
  #elif BUILD_SURFACE == 3
    vec2 brick = bq / vec2(0.32, 0.12);
    brick.x += mod(floor(brick.y), 2.0) * 0.5;
    joints = max(fineLine(brick.x, 0.026), fineLine(brick.y, 0.05));
    pigment = (hash(vec3(floor(brick), 7.0)) - 0.5) * 0.25 + (noise(surface * 38.0) - 0.5) * 0.08 * detailAt(bq, 38.0);
    relief = noise(surface * 24.0) * 0.0013 * detailAt(bq, 24.0);
  #elif BUILD_SURFACE == 4 || BUILD_SURFACE == 14
    vec2 block = bq / vec2(0.6, 0.3);
    block.x += mod(floor(block.y), 2.0) * 0.5;
    joints = max(fineLine(block.x, 0.012), fineLine(block.y, 0.018));
    pigment = (hash(vec3(floor(block), 4.0)) - 0.5) * 0.16 + (noise(surface * 18.0) - 0.5) * 0.1 * detailAt(bq, 18.0);
    relief = noise(surface * 9.0) * 0.0015;
  #elif BUILD_SURFACE == 5
    vec2 tile = bq / BUILD_TILE_SIZE;
    joints = max(fineLine(tile.x, 0.009 / BUILD_TILE_SIZE), fineLine(tile.y, 0.009 / BUILD_TILE_SIZE));
    pigment = (hash(vec3(floor(tile), 2.0)) - 0.5) * 0.06;
    spec *= 1.0 - joints;
  #elif BUILD_SURFACE == 6
    joints = max(fineLine(bq.x / 2.0, 0.0015), fineLine(bq.y / 2.0, 0.0015)) * 0.25;
    pigment = (noise(surface * 1.1) - 0.5) * 0.13 + (noise(surface * 48.0) - 0.5) * 0.08 * detailAt(bq, 48.0);
    relief = noise(surface * 27.0) * 0.0005 * detailAt(bq, 27.0);
  #elif BUILD_SURFACE == 7
    float fresnel = pow(1.0 - abs(dot(n, viewDir)), 3.0);
    tone = mix(tone, vec3(0.82, 0.94, 0.99), 0.2 + fresnel * 0.4);
    glow = vec3(0.65, 0.82, 0.94) * fresnel * 0.25;
  #elif BUILD_SURFACE == 8 || BUILD_SURFACE == 9 || BUILD_SURFACE == 13
    #if BUILD_SURFACE == 9
      float boardWidth = 0.20; float boardLength = 2.1;
    #elif BUILD_SURFACE == 13
      float boardWidth = 0.14; float boardLength = 2.4;
    #else
      float boardWidth = 0.18; float boardLength = 1.8;
    #endif
    float row = floor(bq.y / boardWidth);
    float offset = hash(vec3(row, 2.0, 0.0));
    float butt = bq.x / boardLength + offset;
    joints = max(fineLine(bq.y / boardWidth, 0.008), fineLine(butt, 0.002));
    lines = max(0.0, timberGrain(bq)) * 0.5;
    pigment = (hash(vec3(row, floor(butt), 3.0)) - 0.5) * 0.14;
    relief = lines * 0.0005;
    #if BUILD_SURFACE == 13
      joints = max(fineLine(bq.y / boardWidth, 0.026), fineLine(butt, 0.004));
      float fixing = exp(-pow(abs(fract(butt + 0.5) - 0.5) * boardLength * 150.0, 2.0))
        * exp(-pow(abs(fract(bq.y / boardWidth) - 0.22) * 32.0, 2.0));
      lines += fixing * 0.7 * detailAt(bq, 100.0);
      pigment += (noise(surface * 7.0) - 0.5) * 0.1;
    #endif
  #elif BUILD_SURFACE == 10
    // A true herringbone tessellation: horizontal 4×1 fingers alternate with vertical 1×4 fingers.
    vec2 g = vec2(bq.x + bq.y, bq.y - bq.x) * 0.70710678 / 0.10;
    vec2 cell = floor(g);
    float diagonal = mod(cell.x - cell.y, 8.0);
    bool across = diagonal < 4.0;
    float along = across ? diagonal + fract(g.x) : 7.0 - diagonal + fract(g.y);
    float crosswise = across ? fract(g.y) : fract(g.x);
    joints = max(fineLine(along / 4.0, 0.008), fineLine(crosswise, 0.022));
    lines = max(0.0, timberGrain(vec2(along, crosswise) * 0.10)) * 0.4;
    vec2 board = across ? vec2(floor((cell.x - cell.y) / 8.0), cell.y) : vec2(cell.x, floor((cell.x - cell.y) / 8.0));
    pigment = (hash(vec3(board, across ? 2.0 : 7.0)) - 0.5) * 0.3;
  #elif BUILD_SURFACE == 11
    float cloud = noise(surface * 1.4);
    float vein = 1.0 - smoothstep(0.015, 0.045, abs(noise(surface * 1.9 + cloud * 0.75) - 0.48));
    tone *= 1.0 - vein * 0.27;
    pigment = (cloud - 0.5) * 0.06;
    joints = max(fineLine(bq.x / 1.0, 0.0015), fineLine(bq.y / 1.0, 0.0015));
  #elif BUILD_SURFACE == 12
    float weave = clothWeave(bq);
    lines = weave * 0.38;
    pigment = (noise(surface * 7.0) - 0.5) * 0.09;
    relief = weave * 0.0009;
  ${expansionSurfaceGlsl}
  #endif
  tone *= 1.0 + pigment;
  #if BUILD_SURFACE == 3 || BUILD_SURFACE == 4 || BUILD_SURFACE == 5 || BUILD_SURFACE == 14 || BUILD_SURFACE == 20 || BUILD_SURFACE == 21 || BUILD_SURFACE == 22
    tone = mix(tone, uJointTone, joints * 0.75);
  #else
    tone *= 1.0 - joints * 0.45;
  #endif
  n = texturedNormal(n, vWorldPos, relief);
  sn = n;
`;
