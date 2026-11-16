import { shelterMap } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../../state/game";
import { weatherNow } from "../weatherState";
import { skyDome } from "../pencil";

/**
 * Falling rain: thousands of streaks in a box that follows where the camera is looking, all moved by the graphics
 * card from the clock (nothing is updated from JavaScript). Streaks come down at a slant with the wind and thin out
 * as the rain eases. A picture of what's covered, made from the house (roofs, upper floors, and rooms shut in by
 * walls), makes each streak vanish where it would hit a roof or ceiling, so rain stays outside however the roof is
 * being shown: hiding it in cutaway mode changes the view, not where it's dry.
 */

const DROPS = 4600;
const SPAN = 48;
const HEIGHT = 26;
/** The greatest cover height the picture can hold, metres. */
const COVER_MAX = 16;

const vertex = /* glsl */ `
  attribute vec4 aRand;
  attribute float aEnd;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform sampler2D uCover;
  uniform vec4 uRect;
  uniform vec2 uSlant;
  varying float vFade;
  void main() {
    vec2 off = aRand.xy * ${SPAN.toFixed(1)};
    vec2 xz = uCenter.xz + mod(off - uCenter.xz + ${(SPAN / 2).toFixed(1)}, ${SPAN.toFixed(1)}) - ${(SPAN / 2).toFixed(1)};
    float speed = 15.0 + aRand.w * 7.0;
    float y = mod(aRand.z * ${HEIGHT.toFixed(1)} - uTime * speed, ${HEIGHT.toFixed(1)});
    xz += uSlant * y;
    vec2 uv = (xz - uRect.xy) / uRect.zw;
    float cover = 0.0;
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) cover = texture2D(uCover, uv).r * ${COVER_MAX.toFixed(1)};
    vec3 p = vec3(xz.x, y, xz.y);
    vec3 dir = normalize(vec3(uSlant.x, -1.0, uSlant.y));
    if (aEnd > 0.5) p -= dir * (0.55 + aRand.w * 0.5);
    float dist = distance(cameraPosition, p);
    // gone below the roof it would land on, and thinning out with distance and at the very ground
    vFade = (y < cover + 0.08 || y < 0.05) ? 0.0 : (1.0 - smoothstep(26.0, 46.0, dist)) * smoothstep(0.0, 0.5, y - cover);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;
  void main() {
    if (vFade <= 0.001) discard;
    gl_FragColor = vec4(uColor, uAlpha * vFade);
  }
`;

export function Rain() {
  const bp = useGame((s) => s.view);
  const lines = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(DROPS * 2 * 3);
    const rand = new Float32Array(DROPS * 2 * 4);
    const end = new Float32Array(DROPS * 2);
    let seed = 12345;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < DROPS; i++) {
      const a = [r(), r(), r(), r()];
      for (let v = 0; v < 2; v++) {
        rand.set(a, (i * 2 + v) * 4);
        end[i * 2 + v] = v;
      }
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
    g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    return g;
  }, []);

  const cover = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uCover: { value: cover },
          uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
          uSlant: { value: new THREE.Vector2(0.18, 0.1) },
          uColor: { value: new THREE.Color(0.8, 0.88, 0.97) },
          uAlpha: { value: 0.5 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [cover],
  );

  // the covered-ground picture, remade when the house changes
  useEffect(() => {
    if (!bp) return;
    const map = shelterMap(bp);
    const data = new Uint8Array(map.cols * map.rows);
    for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.round((map.height[i]! / COVER_MAX) * 255));
    const t = new THREE.DataTexture(data, map.cols, map.rows, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    material.uniforms.uCover!.value = t;
    (material.uniforms.uRect!.value as THREE.Vector4).set(map.ox, map.oz, map.cols, map.rows);
    return () => t.dispose();
  }, [bp, material]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      cover.dispose();
    },
    [geometry, material, cover],
  );

  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, clock }) => {
    const rain = weatherNow.rain;
    const l = lines.current;
    if (!l) return;
    const show = Math.floor(DROPS * Math.min(1, rain * 1.1));
    l.visible = show > 0;
    if (!l.visible) return;
    l.geometry.setDrawRange(0, show * 2);
    // the box follows wherever the camera is looking: the ground it points at, or ahead of it when level
    camera.getWorldDirection(look);
    const t = look.y < -0.05 ? Math.min(-camera.position.y / look.y, 60) : 24;
    (material.uniforms.uCenter!.value as THREE.Vector3).copy(camera.position).addScaledVector(look, t);
    material.uniforms.uTime!.value = clock.elapsedTime;
    // paler by day, a little brighter against the dark at night
    const night = skyDome.night.value;
    (material.uniforms.uColor!.value as THREE.Color).setRGB(0.72 + 0.1 * night, 0.8 + 0.08 * night, 0.92 + 0.05 * night);
    material.uniforms.uAlpha!.value = 0.34 + 0.2 * rain + 0.12 * night;
  });

  return <lineSegments ref={lines} geometry={geometry} material={material} frustumCulled={false} renderOrder={500} raycast={() => null} userData={{ noShadow: true }} />;
}
