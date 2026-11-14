import { dayPhase } from "@cg/shared";
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { serverNow, useGame } from "../state/game";
import { lampSpots } from "./lamps";
import { fogUniform, LAMPS, lighting, SUN_DIR, skyDome } from "./pencil";
import { skyAt } from "./skyModel";

/**
 * The day, drawn: each frame it works out where the shared clock has the sun (see skyModel.ts and the shared world
 * clock), and moves the light, the colour of the air and the haze beyond the lot with it. It also picks the lamps
 * nearest the view to light the night. The clock is the server's, so both screens, a refresh and a reconnect all
 * agree; nothing about the day is stored in the scene.
 */

const look = new THREE.Vector3();
const hit = new THREE.Vector3();

export function Sky() {
  const view = useGame((s) => s.view);
  const lamps = useMemo(() => (view ? lampSpots(view) : []), [view]);

  useFrame(({ camera, scene }) => {
    const world = useGame.getState().life?.world;
    const sky = skyAt(dayPhase(serverNow(), world));
    SUN_DIR.set(...sky.lightDir);
    lighting.sun.value.set(...sky.sun);
    lighting.skyLight.value.set(...sky.sky);
    lighting.bounce.value.set(...sky.bounce);
    lighting.night.value = sky.night;
    // a cool, slightly dimmer cast over everything at night (the pictures drawn in withDaylight() don't see it)
    lighting.tint.value.setRGB(1 - 0.3 * (1 - sky.day), 1 - 0.2 * (1 - sky.day), 1 - 0.02 * (1 - sky.day));
    fogUniform.value.set(sky.fog).convertLinearToSRGB();
    if (scene.background instanceof THREE.Color) scene.background.set(sky.fog);
    skyDome.horizon.value.set(sky.fog).convertLinearToSRGB();
    skyDome.zenith.value.set(sky.zenith).convertLinearToSRGB();
    skyDome.sunPos.set(...sky.sunDir);
    skyDome.moonDir.set(...sky.moonDir);
    skyDome.night.value = 1 - sky.day;
    skyDome.gold.value = sky.gold;

    // the lamps nearest to wherever the camera is looking
    camera.getWorldDirection(look);
    const t = look.y < -0.05 ? -camera.position.y / look.y : 30;
    hit.copy(camera.position).addScaledVector(look, Math.min(t, 200));
    const slots = lighting.lamps.value;
    if (sky.night <= 0.01) {
      for (const s of slots) s.w = 0;
      return;
    }
    const near = lamps.length <= LAMPS ? lamps : [...lamps].sort((a, b) => Math.hypot(a.x - hit.x, a.z - hit.z) - Math.hypot(b.x - hit.x, b.z - hit.z)).slice(0, LAMPS);
    slots.forEach((s, i) => {
      const l = near[i];
      if (l) s.set(l.x, l.y, l.z, l.r);
      else s.w = 0;
    });
  });

  return null;
}
