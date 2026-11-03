import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const { ACTION } = CameraControlsImpl;

/** Keys currently held, ignoring typing in inputs. */
const held = new Set<string>();
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");

/**
 * The build camera: right-drag to orbit, wheel or middle-drag to zoom, WASD/arrows to pan, Q/E to turn a quarter.
 * The left button is left for the build tools. The camera stays above the ground and near the lot.
 */
export function CameraRig({ w, d }: { w: number; d: number }) {
  const [cc, setCc] = useState<CameraControlsImpl | null>(null);
  const ref = useRef<CameraControlsImpl | null>(null);
  ref.current = cc;

  useEffect(() => {
    if (!cc) return;
    cc.mouseButtons.left = ACTION.NONE;
    cc.mouseButtons.right = ACTION.ROTATE;
    cc.mouseButtons.middle = ACTION.DOLLY;
    cc.mouseButtons.wheel = ACTION.DOLLY;
    cc.touches.one = ACTION.NONE;
    cc.touches.two = ACTION.TOUCH_DOLLY_ROTATE;
    cc.minPolarAngle = 0.2;
    cc.maxPolarAngle = 1.32;
    cc.minDistance = 5;
    cc.maxDistance = 55;
    cc.dollyToCursor = true;
    cc.smoothTime = 0.18;
    cc.setBoundary(new THREE.Box3(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(w + 6, 0, d + 6)));
    void cc.setLookAt(w / 2 + 14, 17, d / 2 + 16, w / 2, 0, d / 2, false);
    // Handy for poking at the camera from the console while developing.
    if (import.meta.env.DEV) (window as unknown as { __camera: CameraControlsImpl }).__camera = cc;
  }, [cc, w, d]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      held.add(k);
      const cc = ref.current;
      if (!cc) return;
      // Snap to the next quarter turn so walls line up with the screen again.
      const quarter = Math.PI / 2;
      if (k === "q" || k === "e") {
        const snapped = Math.round(cc.azimuthAngle / quarter - 0.5) * quarter + quarter / 2;
        void cc.rotateTo(snapped + (k === "q" ? -quarter : quarter), cc.polarAngle, true);
      }
    };
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    const clear = () => held.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useFrame((_, dt) => {
    const cc = ref.current;
    if (!cc) return;
    const speed = Math.max(4, cc.distance * 0.9) * Math.min(dt, 0.05);
    const x = (held.has("d") || held.has("arrowright") ? 1 : 0) - (held.has("a") || held.has("arrowleft") ? 1 : 0);
    const z = (held.has("w") || held.has("arrowup") ? 1 : 0) - (held.has("s") || held.has("arrowdown") ? 1 : 0);
    if (x) void cc.truck(x * speed, 0, true);
    if (z) void cc.forward(z * speed, true);
  });

  return <CameraControls ref={setCc} makeDefault />;
}
