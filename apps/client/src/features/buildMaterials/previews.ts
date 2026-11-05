import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { Kit } from "../../render/kit";
import { natureMaterial } from "../../render/nature";
import { buildingMaterial, type MaterialKind } from "./material";
import { buildWall } from "./wallGeometry";

const pictures = new Map<string, string>(), queued = new Map<string, [MaterialKind, string]>(), listeners = new Set<() => void>();
let renderer: THREE.WebGLRenderer | null = null, scheduled = false;

function draw(kind: MaterialKind, id: string) {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(160, 110, false); renderer.setPixelRatio(1); renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor("#e7e9e1", 1);
  const scene = new THREE.Scene(), kit = new Kit(), material = buildingMaterial(kind, id);
  if (kind === "wall") {
    buildWall(kit, { dir: "h", at: 0, from: 0, to: 2, style: id }, 1.6, material, natureMaterial("#f3eee4"));
    // Seen through the clear glass; not a second opaque face on the glazing itself.
    if (material.userData.buildGlass) {
      kit.box(natureMaterial("#e1a06b"), [0.6, .55, -.45], [.6, 1.1, .25], { outline: false });
      kit.box(natureMaterial("#739b6b"), [1.35, .35, -.45], [.65, .7, .25], { outline: false });
    }
  } else kit.box(material, [1, 0, 1], [2, .05, 2], { outline: false });
  const meshes = kit.build();
  meshes.forEach((b) => scene.add(new THREE.Mesh(b.geometry, b.material)));
  const camera = new THREE.PerspectiveCamera(35, 160/110, .05, 30);
  if (kind === "wall") { camera.position.set(2.6, 2, 3.8); camera.lookAt(1, .8, 0); }
  else { camera.position.set(3.3, 3.8, 4); camera.lookAt(1, 0, 1); }
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  meshes.forEach((b) => b.geometry.dispose());
  return url;
}
function schedule() {
  if (scheduled) return; scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const item = queued.entries().next().value;
    if (item) { const [key, [kind, id]] = item; queued.delete(key); try { pictures.set(key, draw(kind, id)); } catch { pictures.set(key, ""); } }
    listeners.forEach((l) => l());
    if (queued.size) schedule();
  });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useMaterialPreview(kind: MaterialKind, id: string) {
  const key = `${kind}:${id}`, url = useSyncExternalStore(subscribe, () => pictures.get(key) ?? null);
  if (url === null && !queued.has(key)) { queued.set(key, [kind, id]); schedule(); }
  return url;
}
