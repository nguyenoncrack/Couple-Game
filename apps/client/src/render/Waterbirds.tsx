import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "./Ambient";
import { Kit, type BuiltMesh } from "./kit";
import { natureMaterial } from "./nature";
import { WATERBIRDS, waterbirdPose } from "./waterbirdLayout";

/** A mallard pair and three ducklings. Every part is merged by material, then instanced by bird kind. */
export function duckModel(kind: number) {
  const k = new Kit();
  const m = (c: string) => natureMaterial(c, { finish: "foliage" });
  const back = m(kind === 0 ? "#8b8880" : kind === 1 ? "#826d50" : "#bdad68");
  const head = m(kind === 0 ? "#335c48" : kind === 1 ? "#72614b" : "#cdbb72");
  const wing = m(kind === 0 ? "#615b51" : "#665a43");
  k.add("sphere", back, [0, 0.11, 0], [0.32, 0.26, 0.55]);
  k.add("sphere", back, [0, 0.09, -0.25], [0.19, 0.1, 0.26], { rot: [-0.25, 0, 0] });
  k.add("sphere", head, [0, 0.27, 0.2], [0.17, 0.22, 0.17]);
  k.add("sphere", m("#c8a15c"), [0, 0.24, 0.31], [0.09, 0.045, 0.15]);
  for (const side of [-1, 1]) {
    k.add("sphere", wing, [side * 0.135, 0.16, -0.035], [0.07, 0.16, 0.35], { rot: [0.1, 0, side * -0.12] });
    k.add("sphere", m("#252d25"), [side * 0.078, 0.29, 0.24], 0.018);
  }
  if (kind === 0) k.add("torus", m("#d9d6bf"), [0, 0.2, 0.2], [0.145, 0.145, 0.13], { rot: [Math.PI / 2, 0, 0] });
  return k.build();
}

export function Waterbirds({ w }: { w: number }) {
  const still = useReducedMotion();
  const models = useMemo(() => [0, 1, 2].map(duckModel), []);
  useEffect(() => () => models.flat().forEach((m) => m.geometry.dispose()), [models]);
  return <group name="lake-waterbirds">{models.flatMap((model, kind) => model.map((mesh, i) => <BirdPart key={`${kind}:${i}`} mesh={mesh} kind={kind} w={w} still={still} />))}{!still && <Wakes w={w} />}</group>;
}

const transform = new THREE.Object3D();
function BirdPart({ mesh, kind, w, still }: { mesh: BuiltMesh; kind: number; w: number; still: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const indices = kind < 2 ? [kind] : [2, 3, 4];
  useFrame(({ clock }) => {
    const target = ref.current!;
    indices.forEach((index, slot) => {
      const p = waterbirdPose(w, index, still ? 0 : clock.elapsedTime);
      transform.position.set(p.x, p.y, p.z); transform.rotation.set(0, p.turn, 0); transform.scale.setScalar(p.scale); transform.updateMatrix();
      target.setMatrixAt(slot, transform.matrix);
    });
    target.instanceMatrix.needsUpdate = true;
  });
  useEffect(() => { const m = ref.current; return () => m?.dispose(); }, []);
  // Their tiny route is bounded; avoid stale instance bounds as they swim along it.
  return <instancedMesh ref={ref} args={[mesh.geometry, mesh.material, indices.length]} frustumCulled={false} userData={{ noShadow: true }} dispose={null} raycast={() => null} />;
}

function Wakes({ w }: { w: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.RingGeometry(0.93, 1, 20, 1, Math.PI * 0.13, Math.PI * 0.74).rotateX(-Math.PI / 2).scale(0.3, 1, 0.7), []);
  const material = useMemo(() => natureMaterial("#c5dcdb", { alpha: 0.25 }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    for (let i = 0; i < WATERBIRDS; i++) {
      const p = waterbirdPose(w, i, clock.elapsedTime);
      transform.position.set(p.x - Math.sin(p.turn) * 0.3 * p.scale, 0.038, p.z - Math.cos(p.turn) * 0.3 * p.scale);
      transform.rotation.set(0, p.turn, 0); transform.scale.setScalar(p.scale); transform.updateMatrix(); ref.current!.setMatrixAt(i, transform.matrix);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
  });
  useEffect(() => { const mesh = ref.current; return () => mesh?.dispose(); }, []);
  return <instancedMesh ref={ref} args={[geometry, material, WATERBIRDS]} frustumCulled={false} userData={{ noShadow: true }} dispose={null} raycast={() => null} />;
}
