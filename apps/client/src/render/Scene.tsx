import { Canvas } from "@react-three/fiber";
import { useGame } from "../state/game";
import { BuildTools } from "../tools/BuildTools";
import { LiveTools } from "../tools/LiveTools";
import { CameraRig } from "./CameraRig";
import { FirstPersonRig } from "./FirstPerson";
import { Characters } from "./Characters";
import { LifeProps } from "./LifeProps";
import { Lot } from "./Lot";
import { PartnerPresence } from "./Partner";
import { FOG } from "./pencil";
import { Scenery } from "./Scenery";
import { Lifts } from "./Lifts";
import { PartyLights } from "./party/PartyLights";
import { Storeys } from "./Storeys";
import { Sunlight } from "./Sunlight";

/** The 3D view. Reads the house I see (`view`) and draws it; never changes it directly. */
export function Scene() {
  const lot = useGame((s) => s.view?.lot);
  const mode = useGame((s) => s.mode);
  const firstPerson = useGame((s) => s.mode === "live" && s.firstPerson);
  if (!lot) return null;

  return (
    <Canvas
      className="scene"
      flat
      dpr={[1, 2]}
      camera={{ fov: 38, near: 0.1, far: 400 }}
      gl={{ antialias: true, preserveDrawingBuffer: import.meta.env.DEV }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <color attach="background" args={[FOG]} />
      {firstPerson ? <FirstPersonRig /> : <CameraRig w={lot.w} d={lot.d} />}
      <Lot w={lot.w} d={lot.d} />
      <Scenery w={lot.w} d={lot.d} />
      <Storeys />
      <Lifts />
      {mode === "live" ? <LiveTools /> : <BuildTools />}
      <Characters />
      <LifeProps />
      <PartyLights />
      <PartnerPresence />
      <Sunlight w={lot.w} d={lot.d} />
    </Canvas>
  );
}
