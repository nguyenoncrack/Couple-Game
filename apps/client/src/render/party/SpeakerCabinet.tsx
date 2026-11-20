import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { BuiltMesh } from "../kit";
import { Meshes } from "../KitMesh";
import { speakerMotion } from "./speakerMotion";

/** Rock the cabinet in its own axes so its housing, outlines and rings all move together. */
export function SpeakerCabinet({ meshes }: { meshes: BuiltMesh[] }) {
  const cabinet = useRef<Group>(null);
  useFrame(() => {
    const group = cabinet.current;
    if (!group) return;
    const { cone, rock } = speakerMotion;
    const pitch = -0.065 * rock;
    const roll = 0.048 * rock;
    group.rotation.set(pitch, 0, roll);
    // Lift just enough for the tilted feet to clear the floor.
    group.position.y = 0.22 * Math.abs(pitch) + 0.28 * Math.abs(roll);
    group.scale.y = 1 - 0.018 * cone;
  });
  return (
    <group ref={cabinet}>
      <Meshes meshes={meshes} />
    </group>
  );
}
