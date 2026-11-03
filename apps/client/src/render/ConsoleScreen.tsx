import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";

function Tile({ x = 0, y = 0, z = 0, w, h, color }: { x?: number; y?: number; z?: number; w: number; h: number; color: string }) {
  return <mesh position={[x, y, z]} raycast={() => null}><planeGeometry args={[w, h]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>;
}

function Car({ color }: { color: string }) {
  return <>
    <Tile w={0.09} h={0.14} color="#263843" />
    <Tile z={0.001} w={0.07} h={0.15} color={color} />
    <Tile z={0.002} y={0.025} w={0.055} h={0.035} color="#d4eced" />
    <Tile z={0.002} y={-0.035} w={0.05} h={0.025} color="#3b606d" />
  </>;
}

/** A little racing scene shows the TV is being used for gaming; no extra server ticks or game rules. */
export function ConsoleScreen() {
  const lanes = useRef<THREE.Group>(null);
  const player = useRef<THREE.Group>(null);
  const rival = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    lanes.current?.children.forEach((line, i) => { line.position.y = 0.23 - ((t * 0.22 + i * 0.115) % 0.46); });
    if (player.current) player.current.position.x = -0.1 + Math.sin(t * 1.2) * 0.08;
    if (rival.current) rival.current.position.y = 0.18 - ((t * 0.14) % 0.36);
  });
  return <group position={[0, 1.08, -0.201]}>
    <Tile w={1.28} h={0.55} color="#81ad78" />
    <Tile w={0.58} h={0.55} color="#4a5960" z={0.001} />
    {[-1, 1].map((s) => <Tile key={s} x={s * 0.30} w={0.018} h={0.55} color="#efe4b9" z={0.002} />)}
    <group ref={lanes}>{[0, 1, 2, 3].map((i) => <group key={i}><Tile w={0.012} h={0.075} color="#eadfb6" z={0.003} /></group>)}</group>
    <group ref={player} position={[-0.1, -0.12, 0.004]}><Car color="#ee9274" /></group>
    <group ref={rival} position={[0.13, 0.12, 0.004]}><Car color="#f0d260" /></group>
    <Tile x={-0.47} y={0.20} z={0.005} w={0.22} h={0.055} color="#324b53" />
    <Tile x={-0.48} y={0.20} z={0.006} w={0.16} h={0.018} color="#f6db86" />
    {[-1, 1].map((s) => <group key={s}>{[-0.17, 0.02, 0.18].map((y, i) => <Tile key={y} x={s * (0.43 + i % 2 * 0.09)} y={y} z={0.002} w={0.07} h={0.09} color="#557d5d" />)}</group>)}
  </group>;
}
