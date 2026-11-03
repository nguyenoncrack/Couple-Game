import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useGame } from "../state/game";

const { ACTION } = CameraControlsImpl;

/** Keys currently held, ignoring typing in inputs. */
const held = new Set<string>();
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");

/** Where the pointer is on screen, for panning at the edges while dragging. */
const pointer = { x: -1, y: -1, inside: false };

/** Set by the build tools while a drag is in progress (a wall, a floor, or furniture being moved). */
export const autoPan = { active: false };

/**
 * Space or Option held: the left button drives the camera instead of the build tools (pan or orbit), which makes
 * the camera usable from a trackpad with no right or middle button.
 */
export function cameraGestureActive() {
  return held.has(" ") || held.has("alt");
}

/** Where my character is, written every frame; the camera keeps it centred while following is on. */
export const cameraFollow = { target: null as { x: number; z: number } | null };

let controls: CameraControlsImpl | null = null;
let home: (() => void) | null = null;
const QUARTER = Math.PI / 2;

/** Camera actions for the on-screen buttons. */
export const cameraApi = {
  /** Turn a quarter, snapping to the diagonals so walls line up with the screen. */
  turn(dir: -1 | 1) {
    if (!controls) return;
    const snapped = Math.round(controls.azimuthAngle / QUARTER - 0.5) * QUARTER + QUARTER / 2;
    void controls.rotateTo(snapped + dir * QUARTER, controls.polarAngle, true);
  },
  zoom(dir: -1 | 1) {
    if (!controls) return;
    void controls.dolly(dir * controls.distance * 0.25, true);
  },
  recenter() {
    home?.();
  },
};

/**
 * The build camera.
 *  - orbit: right-drag, or Option + drag
 *  - pan: Space + drag, Shift + right-drag, middle-drag, W A S D / arrows
 *  - zoom: scroll or pinch, + / -
 *  - Q / E turn a quarter, H goes back to the whole lot
 * While building, dragging near the edge of the screen pans the view along.
 */
export function CameraRig({ w, d }: { w: number; d: number }) {
  const [cc, setCc] = useState<CameraControlsImpl | null>(null);
  const ref = useRef<CameraControlsImpl | null>(null);
  ref.current = cc;

  useEffect(() => {
    if (!cc) return;
    controls = cc;
    cc.mouseButtons.left = ACTION.NONE;
    cc.mouseButtons.right = ACTION.ROTATE;
    cc.mouseButtons.middle = ACTION.SCREEN_PAN;
    cc.mouseButtons.wheel = ACTION.DOLLY;
    cc.touches.one = ACTION.NONE;
    cc.touches.two = ACTION.TOUCH_DOLLY_TRUCK;
    cc.touches.three = ACTION.TOUCH_ROTATE;
    cc.minPolarAngle = 0.2;
    cc.maxPolarAngle = 1.32;
    cc.minDistance = 4;
    cc.maxDistance = 60;
    cc.dollyToCursor = true;
    cc.smoothTime = 0.18;
    cc.truckSpeed = 1.6;
    cc.setBoundary(new THREE.Box3(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(w + 6, 0, d + 6)));
    home = () => void cc.setLookAt(w / 2 + 14, 17, d / 2 + 16, w / 2, 0, d / 2, true);
    void cc.setLookAt(w / 2 + 14, 17, d / 2 + 16, w / 2, 0, d / 2, false);
    // Handy for poking at the camera from the console while developing.
    if (import.meta.env.DEV) (window as unknown as { __camera: CameraControlsImpl }).__camera = cc;
    return () => {
      if (controls === cc) controls = null;
    };
  }, [cc, w, d]);

  useEffect(() => {
    // Modifier keys change what the buttons do: Space + drag pans, Option + drag orbits, Shift + right-drag pans.
    const leftFor = () => {
      const c = ref.current;
      if (!c) return;
      c.mouseButtons.left = held.has(" ") ? ACTION.SCREEN_PAN : held.has("alt") ? ACTION.ROTATE : ACTION.NONE;
      c.mouseButtons.right = held.has("shift") ? ACTION.SCREEN_PAN : ACTION.ROTATE;
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      // Space would scroll the page or press a focused button.
      if (k === " ") e.preventDefault();
      held.add(k);
      leftFor();
      if (k === "q" || k === "e") cameraApi.turn(k === "q" ? -1 : 1);
      else if (k === "=" || k === "+") cameraApi.zoom(1);
      else if (k === "-" || k === "_") cameraApi.zoom(-1);
      else if (k === "h") cameraApi.recenter();
    };
    const up = (e: KeyboardEvent) => {
      held.delete(e.key.toLowerCase());
      leftFor();
    };
    const clear = () => {
      held.clear();
      leftFor();
    };
    const move = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
    };
    const leave = () => (pointer.inside = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  useFrame(({ size }, dt) => {
    const c = ref.current;
    if (!c) return;
    const speed = Math.max(4, c.distance * 0.9) * Math.min(dt, 0.05);
    let x = (held.has("d") || held.has("arrowright") ? 1 : 0) - (held.has("a") || held.has("arrowleft") ? 1 : 0);
    let z = (held.has("w") || held.has("arrowup") ? 1 : 0) - (held.has("s") || held.has("arrowdown") ? 1 : 0);
    // Dragging something toward the edge of the screen: follow it.
    if (autoPan.active && pointer.inside) {
      const m = 48;
      const edge = (v: number, max: number) => (v < m ? -(1 - v / m) : v > max - m ? 1 - (max - v) / m : 0);
      x += edge(pointer.x, size.width);
      z -= edge(pointer.y, size.height);
    }
    if (x) void c.truck(x * speed, 0, true);
    if (z) void c.forward(z * speed, true);
    const follow = useGame.getState().follow;
    // panning by hand means you want to look elsewhere
    if (follow && (x || z)) useGame.setState({ follow: false });
    else if (follow && cameraFollow.target) void c.moveTo(cameraFollow.target.x, 0, cameraFollow.target.z, true);
  });

  return <CameraControls ref={setCc} makeDefault />;
}
