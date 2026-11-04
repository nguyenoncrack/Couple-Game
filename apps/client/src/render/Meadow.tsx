import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGame } from "../state/game";
import { flower, grassTuft, SWAY } from "./botanicalModels";
import { Kit, type BuiltMesh } from "./kit";
import { meadowLayout, type Sprig } from "./meadowLayout";
import type { Finish } from "./pencil";
import { natureMaterial } from "./nature";

/** Instanced meadow plants: a handful of shared meshes, no per-plant React nodes, network events or raycasts. */
export function Meadow({ w, d }: { w: number; d: number }) {
  const level = useGame((s) => s.view?.levels[0]);
  const layout = useMemo(() => level ? meadowLayout(w, d, level) : null, [w, d, level]);
  const models = useMemo(() => {
    const make = (fn: (k: Kit) => void) => { const k = new Kit(); fn(k); return k.build(); };
    const m = (tone: string, finish?: Finish) => natureMaterial(tone, { finish, rim: false, sway: SWAY });
    return [
      make((k) => grassTuft(k, m)),
      make((k) => flower(k, m, "daisy", "#f5eed9")),
      make((k) => flower(k, m, "daisy", "#ec809e", 0.4)),
      make((k) => flower(k, m, "lavender", "#a07cc9", 0.49)),
    ];
  }, []);
  useEffect(() => () => models.flat().forEach((b) => b.geometry.dispose()), [models]);
  const groups = useMemo(() => layout ? [layout.grass, ...[0, 1, 2].map((kind) => layout.flowers.filter((s) => s.kind === kind))] : [], [layout]);
  return <group name="meadow">{groups.map((sprigs, i) => models[i]!.map((mesh, j) => <Patch key={`${i}:${j}`} mesh={mesh} sprigs={sprigs} />))}</group>;
}

function Patch({ mesh, sprigs }: { mesh: BuiltMesh; sprigs: Sprig[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const target = ref.current!;
    target.count = sprigs.length;
    const transform = new THREE.Object3D();
    sprigs.forEach((s, i) => {
      transform.position.set(s.x, 0.002, s.z);
      transform.rotation.set(0, s.turn, 0);
      transform.scale.setScalar(s.scale);
      transform.updateMatrix();
      target.setMatrixAt(i, transform.matrix);
    });
    target.instanceMatrix.needsUpdate = true;
    target.computeBoundingSphere();
  }, [sprigs]);
  useEffect(() => { const mesh = ref.current; return () => mesh?.dispose(); }, []);
  return <instancedMesh ref={ref} args={[mesh.geometry, mesh.material, 2700]} dispose={null} raycast={() => null} />;
}
