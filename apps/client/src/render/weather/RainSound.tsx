import { positionAt, rainAt, shelterMap, underCover } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { setRainSound } from "../../state/ambience";
import { serverNow, useGame } from "../../state/game";

/**
 * Tells the sound system how hard it's raining and whether you're under cover: your own character's spot in Live
 * mode (inside the roof or a shut-in room, it's softer), or where the camera is looking when you're building.
 * Rain and the weather itself are the shared clock's; only the listening is local.
 */

const look = new THREE.Vector3();

export function RainSound() {
  const bp = useGame((s) => s.view);
  const map = useMemo(() => (bp ? shelterMap(bp) : null), [bp]);
  const mem = useRef({ since: 0, indoors: 0 });

  useFrame(({ camera, clock }) => {
    // a few times a second is plenty
    if (clock.elapsedTime - mem.current.since < 0.2) return;
    mem.current.since = clock.elapsedTime;
    const state = useGame.getState();
    const now = serverNow();
    const level = rainAt(now, state.life?.world);
    if (!map || !state.me) return setRainSound(level, 0);
    let x: number;
    let y: number;
    let z: number;
    const me = state.life?.avatars[state.me];
    if (state.mode === "live" && me) {
      const p = positionAt(me, now);
      [x, y, z] = [p.x, p.y, p.z];
    } else {
      // building: where the camera is looking, on the ground
      camera.getWorldDirection(look);
      const t = look.y < -0.05 ? Math.min(-camera.position.y / look.y, 80) : 0;
      [x, y, z] = [camera.position.x + look.x * t, 0, camera.position.z + look.z * t];
    }
    const target = underCover(map, x, y, z) ? 1 : 0;
    mem.current.indoors += (target - mem.current.indoors) * 0.6;
    setRainSound(level, mem.current.indoors);
  });
  return null;
}
