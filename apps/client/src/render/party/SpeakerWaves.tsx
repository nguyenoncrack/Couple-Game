import { catalog, STOREY, type Blueprint } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../../state/game";
import { FLOOR_Y } from "../House";
import { topShown } from "../Storeys";
import { RoomRays } from "./partyLayout";
import { speakerMotion } from "./speakerMotion";

const MAX_SPEAKERS = 16;
const RINGS = 2;
const REACH = 2.3;
const ring = new THREE.RingGeometry(0.72, 1, 40);
const waveMaterial = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
  vertexShader: /* glsl */ `
    varying vec2 vRing;
    varying float vStrength;
    void main() {
      vRing = position.xy;
      #ifdef USE_INSTANCING_COLOR
        vStrength = instanceColor.r;
      #else
        vStrength = 0.0;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vRing;
    varying float vStrength;
    void main() {
      float r = length(vRing);
      float rim = smoothstep(0.72, 0.81, r) * (1.0 - smoothstep(0.94, 1.0, r));
      float core = 1.0 - smoothstep(0.018, 0.075, abs(r - 0.87));
      vec3 tint = mix(vec3(0.22, 0.65, 1.0), vec3(0.55, 0.30, 1.0), vRing.x * 0.5 + 0.5);
      gl_FragColor = vec4(mix(tint, vec3(0.85, 0.99, 1.0), core * 0.75), rim * vStrength);
      #include <colorspace_fragment>
    }
  `,
});

function collectSpeakers(view: Blueprint, top: number) {
  return view.levels.slice(0, top + 1).flatMap((level, index) =>
    Object.values(level.objects).filter((o) => catalog.furniture.get(o.catalogId)?.model.kind === "speaker").map((o) => ({
      x: o.x + 0.5,
      z: o.z + 0.5,
      y: index * STOREY + FLOOR_Y + 0.42,
      yaw: -o.rot * Math.PI / 2,
      level: index,
    })),
  ).slice(0, MAX_SPEAKERS).map((s) => {
    const rays = new RoomRays(view.levels[s.level], view.lot, s.x, s.z, REACH, s.level > 0);
    return { ...s, reach: Math.min(rays.at(s.yaw), rays.at(s.yaw - 0.5), rays.at(s.yaw + 0.5)) };
  });
}

/** One instanced draw for all room-scale ripples, parented to each speaker's placement and facing. */
export function SpeakerWaves() {
  const view = useGame((s) => s.view);
  const top = useGame(topShown);
  const speakers = useMemo(() => view ? collectSpeakers(view, top) : [], [view, top]);
  const waves = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ pose: new THREE.Object3D(), color: new THREE.Color() }), []);

  useFrame(() => {
    const mesh = waves.current;
    if (!mesh) return;
    const { phase, strength } = speakerMotion;
    let count = 0;
    if (strength > 0.02) {
      const { pose, color } = tmp;
      for (const speaker of speakers) {
        if (speaker.reach < 0.5) continue;
        const dx = Math.sin(speaker.yaw);
        const dz = Math.cos(speaker.yaw);
        for (let i = 0; i < RINGS; i++) {
          const age = (phase + 1 - 0.24 * i) % 1;
          const opacity = Math.min(1, age * 18) * (1 - age) ** 1.4 * strength * (i === 0 ? 0.9 : 0.52);
          if (opacity < 0.015) continue;
          const travel = 0.31 + (speaker.reach - 0.31) * age;
          const radius = 0.25 + travel * 0.42;
          pose.position.set(speaker.x + dx * travel, speaker.y + age * 0.21, speaker.z + dz * travel);
          pose.rotation.set(-0.24, speaker.yaw, 0, "YXZ");
          pose.scale.set(radius, radius * 0.52, 1);
          pose.updateMatrix();
          mesh.setMatrixAt(count, pose.matrix);
          mesh.setColorAt(count, color.setRGB(opacity, 0, 0));
          count++;
        }
      }
    }
    mesh.count = count;
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  if (speakers.length === 0) return null;
  return <instancedMesh ref={waves} args={[ring, waveMaterial, MAX_SPEAKERS * RINGS]} count={0} frustumCulled={false} raycast={() => null} />;
}
