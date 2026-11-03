import { Canvas } from "@react-three/fiber";
import { useGame } from "../state/game";
import { BuildTools } from "../tools/BuildTools";
import { LiveTools } from "../tools/LiveTools";
import { CameraRig } from "./CameraRig";
import { FirstPersonRig } from "./FirstPerson";
import { Characters } from "./Characters";
import { Floors } from "./House";
import { LifeProps } from "./LifeProps";
import { Lot } from "./Lot";
import { PartnerPresence } from "./Partner";
import { FOG } from "./pencil";

/** The 3D view. Reads the house I see (`view`) and draws it; never changes it directly. */
export function Scene() {
  const lot = useGame((s) => s.view?.lot);
  const level = useGame((s) => s.view?.levels[0]);
  const mode = useGame((s) => s.mode);
  const firstPerson = useGame((s) => s.mode === "live" && s.firstPerson);
  if (!lot || !level) return null;

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
      <Floors tiles={level.tiles} />
      {mode === "live" ? <LiveTools /> : <BuildTools />}
      <Characters />
      <LifeProps />
      <PartnerPresence />
    </Canvas>
  );
}
