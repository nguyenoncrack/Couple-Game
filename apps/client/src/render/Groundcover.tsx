import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../state/game";
import { groundcoverLayout } from "./groundcoverLayout";
import type { Sprig } from "./meadowLayout";
import { grassGeometry, natureMaterial } from "./nature";

function leafGeometry() {
  const g = new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(0.18, 0.018, 0.09);
  return g;
}

/** Six instanced batches, no collisions or per-sprig animation updates. Wind/fade run on the GPU. */
export function Groundcover({ w, d }: { w: number; d: number }) {
  const level = useGame((s) => s.view?.levels[0]);
  const layout = useMemo(() => level ? groundcoverLayout(w, d, level) : null, [w, d, level]);
  const geometries = useMemo(() => [grassGeometry(), leafGeometry()], []);
  const materials = useMemo(() => [
    ...["#4f8f38", "#68a342", "#83ad48"].map((c) => natureMaterial(c, { finish: "groundcover", sway: 0.3 })),
    ...["#897349", "#a08251", "#727c49"].map((c) => natureMaterial(c, { finish: "foliage" })),
  ], []);
  const groups = useMemo(() => layout ? [layout.grass, layout.litter].flatMap((list) => [0, 1, 2].map((kind) => list.filter((s) => s.kind === kind))) : [], [layout]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  return <group name="natural-groundcover">{groups.map((sprigs, i) => <Batch key={`${i}:${sprigs.length}`} geometry={geometries[i < 3 ? 0 : 1]!} material={materials[i]!} sprigs={sprigs} />)}</group>;
}

function Batch({ geometry, material, sprigs }: { geometry: THREE.BufferGeometry; material: THREE.Material; sprigs: Sprig[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!, at = new THREE.Object3D();
    sprigs.forEach((s, i) => {
      at.position.set(s.x, 0.008, s.z); at.rotation.set(0, s.turn, 0); at.scale.setScalar(s.scale); at.updateMatrix();
      mesh.setMatrixAt(i, at.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [sprigs]);
  useEffect(() => { const mesh = ref.current; return () => mesh?.dispose(); }, []);
  return <instancedMesh ref={ref} args={[geometry, material, sprigs.length]} userData={{ noShadow: true }} dispose={null} raycast={() => null} />;
}
