import { shelterMap } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../../state/game";
import { skyDome } from "../pencil";
import { weatherNow } from "../weatherState";
import { gardenPuddles, MAX_PUDDLES, puddleSpots } from "./puddleLayout";

/**
 * Puddles along the footpaths: flat glassy patches that grow as the ground gets wet, take on the colour of the sky
 * and ripple under falling rain, then shrink away as it dries. One instanced mesh; each puddle's size is worked out
 * every frame from the shared wetness, so they come and go smoothly.
 */

const vertex = /* glsl */ `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  uniform vec3 uSky;
  uniform vec3 uDeep;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    float ang = atan(p.y, p.x);
    // an uneven shoreline
    float shore = 0.82 + 0.1 * sin(ang * 3.0 + vSeed * 20.0) + 0.06 * sin(ang * 7.0 + vSeed * 9.0);
    float body = 1.0 - smoothstep(shore - 0.12, shore, d);
    if (body <= 0.01) discard;
    // sky in the water, darker toward the middle
    vec3 col = mix(uSky, uDeep, smoothstep(0.9, 0.1, d) * 0.55);
    // rings spreading from a couple of spots while it rains
    float rings = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = (vec2(fract(vSeed * 7.3 + fi * 0.37), fract(vSeed * 3.1 + fi * 0.61)) - 0.5) * 1.1;
      float life = fract(uTime * 0.7 + vSeed * 5.0 + fi * 0.33);
      float ring = 1.0 - smoothstep(0.0, 0.07, abs(length(p - c) - life * 0.55));
      rings += ring * (1.0 - life);
    }
    col += vec3(0.9, 0.95, 1.0) * rings * 0.35 * uRain;
    // a bright rim where the water meets the earth
    col += (1.0 - smoothstep(0.0, 0.1, abs(d - shore + 0.05))) * 0.1;
    gl_FragColor = vec4(col, body * 0.82);
  }
`;

export function Puddles({ w, d }: { w: number; d: number }) {
  const bp = useGame((s) => s.view);
  const spots = useMemo(() => {
    const path = puddleSpots(w, d);
    // the paths you've laid fill the rest of the room
    return bp ? [...path, ...gardenPuddles(bp, shelterMap(bp), MAX_PUDDLES - path.length)] : path;
  }, [w, d, bp?.levels[0]?.tiles, bp?.levels[0]?.walls, bp?.levels[0]?.roofs]); // eslint-disable-line react-hooks/exhaustive-deps
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUDDLES), 1));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uTime: { value: 0 }, uRain: { value: 0 }, uSky: { value: new THREE.Color("#b8cfe0") }, uDeep: { value: new THREE.Color("#5d7690") } },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const mat = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const wet = weatherNow.wet;
    let n = 0;
    if (wet > 0.02) {
      for (const p of spots) {
        // each puddle appears at its own wetness and swells from nothing
        const k = Math.min(1, Math.max(0, (wet - p.need * 0.7) / 0.3));
        if (k <= 0.01) continue;
        const e = k * k * (3 - 2 * k);
        q.setFromAxisAngle(up, p.angle);
        m.setMatrixAt(n, mat.compose(pos.set(p.x, 0.045, p.z), q, scl.set(p.rx * e, 1, p.rz * e)));
        // keep each one's seed with it as the list is packed
        (m.geometry.getAttribute("aSeed") as THREE.BufferAttribute).setX(n, p.seed);
        n++;
      }
    }
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    (m.geometry.getAttribute("aSeed") as THREE.BufferAttribute).needsUpdate = true;
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uRain!.value = weatherNow.rain;
    // the sky in the water: pale by day, dark at night, grey in rain
    const night = skyDome.night.value;
    (material.uniforms.uSky!.value as THREE.Color).set("#b8cfe0").lerp(new THREE.Color("#566a9c"), night);
    (material.uniforms.uDeep!.value as THREE.Color).set("#5d7690").lerp(new THREE.Color("#27325a"), night);
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_PUDDLES]} frustumCulled={false} renderOrder={5} raycast={() => null} userData={{ noShadow: true }} />;
}
