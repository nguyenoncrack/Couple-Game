import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Meshes } from "../../render/KitMesh";
import { buildPreviewCharacter as buildCharacter } from "./characterParts";
import type { Appearance } from "./appearance";

function CharacterMesh({ appearance }: { appearance: Appearance }) {
  const meshes = useMemo(() => buildCharacter(appearance), [appearance]);
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  return <group dispose={null}><Meshes meshes={meshes} raycast={false} /></group>;
}
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="character-preview-fallback">The 3D preview isn’t available on this device. You can still choose and save your look.</p>
      : this.props.children;
  }
}
export function CharacterPreview({ appearance }: { appearance: Appearance }) {
  const [turn, setTurn] = useState(0);
  return <>
    <div className="character-canvas" role="img" aria-label="Rotatable preview of your character">
      <PreviewBoundary>
        <Canvas flat dpr={[1, 1.5]} camera={{ position: [0.8, 1.2, 3.7], fov: 32 }}>
          <group rotation={[0, turn * Math.PI / 2, 0]}>
            <CharacterMesh appearance={appearance} />
          </group>
          <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.8, 0.5, 1]}>
            <circleGeometry args={[0.65, 40]} />
            <meshBasicMaterial color="#b8a17c" transparent opacity={0.18} depthWrite={false} />
          </mesh>
          <OrbitControls target={[0, 0.94, 0]} enablePan={false} enableZoom={false} minPolarAngle={0.85} maxPolarAngle={1.65} />
        </Canvas>
      </PreviewBoundary>
    </div>
    <div className="character-turn-controls">
      <button type="button" className="btn" aria-label="Turn character left" onClick={() => setTurn((n) => n - 1)}>↶</button>
      <span>Drag to turn</span>
      <button type="button" className="btn" aria-label="Turn character right" onClick={() => setTurn((n) => n + 1)}>↷</button>
    </div>
  </>;
}
