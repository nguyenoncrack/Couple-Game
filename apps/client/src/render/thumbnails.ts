import { catalog } from "@cg/shared";
import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { modelFor, openingModelFor } from "./models";

/**
 * Little pictures of catalog items for the build panels: each model drawn once in its own pencil style, from the
 * same three-quarter angle as the game camera, on a small offscreen canvas of its own. A few are drawn per frame
 * as they're first asked for, then kept for the rest of the visit.
 */

const W = 128;
const H = 96;
/** Seen from the front-right and above, like the starting camera. */
const VIEW_DIR = new THREE.Vector3(0.9, 0.95, 1.35).normalize();
const FOV = 26;

const pictures = new Map<string, string>();
const queued = new Set<string>();
const listeners = new Set<() => void>();
let renderer: THREE.WebGLRenderer | null = null;
let scheduled = false;

function draw(catalogId: string): string {
  const furniture = catalog.furniture.get(catalogId);
  const opening = catalog.openings.get(catalogId);
  const meshes = furniture ? modelFor(furniture) : opening ? openingModelFor(opening) : [];
  if (!meshes.length) return "";
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
  }

  const scene = new THREE.Scene();
  for (const b of meshes) scene.add(new THREE.Mesh(b.geometry, b.material));
  const box = new THREE.Box3().setFromObject(scene);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.05, 100);
  // Back far enough that the whole model fits the shorter (vertical) side of the picture.
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 0.92;
  camera.position.copy(centre).addScaledVector(VIEW_DIR, distance);
  camera.lookAt(centre);

  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}

function drawSome() {
  scheduled = false;
  const start = performance.now();
  for (const id of queued) {
    queued.delete(id);
    pictures.set(id, draw(id));
    if (performance.now() - start > 12) break;
  }
  listeners.forEach((l) => l());
  if (queued.size) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(drawSome);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** A picture of a catalog item as a data URL, or null until it has been drawn. */
export function useThumbnail(catalogId: string): string | null {
  const picture = useSyncExternalStore(subscribe, () => pictures.get(catalogId) ?? null);
  if (picture === null && !queued.has(catalogId)) {
    queued.add(catalogId);
    schedule();
  }
  return picture || null;
}
