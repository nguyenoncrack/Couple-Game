import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STOREY } from "@cg/shared";
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
 * Space or Option held, or two fingers on a touchscreen: the press drives the camera instead of the build tools
 * (pan or orbit), which makes the camera usable from a trackpad with no right or middle button.
 */
export function cameraGestureActive() {
  return held.has(" ") || held.has("alt") || multiTouch();
}

/** Fingers on a touchscreen right now. With two or more down, the gesture belongs to the camera. */
const touches = new Map<number, { x: number; y: number }>();
export function multiTouch() {
  return touches.size >= 2;
}

/** A wheel event that came from a trackpad (two fingers) rather than a mouse wheel. */
function fromTrackpad(e: WheelEvent) {
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  // Chrome and Safari report a mouse wheel in whole notches of 120; Firefox reports one in lines.
  if (legacy) return legacy === -3 * e.deltaY || e.deltaX !== 0;
  return e.deltaMode === 0;
}

/** Twist angle (radians) between two fingers. */
const twistOf = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);
/** How far fingers must twist before the view turns, so a pinch doesn't wobble it. */
const TWIST_DEADZONE = 0.14;

/**
 * Where my character is, written every frame; the camera keeps it centred while following is on. `eye` is where
 * their eyes are (sitting, lying in the bath, walking), for seeing through them in first person.
 */
export const cameraFollow = {
  target: null as { x: number; z: number; y?: number } | null,
  eye: null as { x: number; y: number; z: number } | null,
};

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
 *  - orbit: right-drag, Option + drag, or twist two fingers (touchscreens, and trackpads in Safari)
 *  - pan: two fingers on a trackpad or screen, Space + drag, Shift + right-drag, middle-drag, W A S D / arrows
 *  - zoom: pinch, mouse wheel, + / -
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
    // the camera looks at the floor you're on: level with it, and kept there while you pan
    const onFloor = (y: number) => cc.setBoundary(new THREE.Box3(new THREE.Vector3(-6, y, -6), new THREE.Vector3(w + 6, y, d + 6)));
    const y0 = useGame.getState().floor * STOREY;
    onFloor(y0);
    home = () => void cc.setLookAt(w / 2 + 14, 17 + useGame.getState().floor * STOREY, d / 2 + 16, w / 2, useGame.getState().floor * STOREY, d / 2, true);
    void cc.setLookAt(w / 2 + 14, 17 + y0, d / 2 + 16, w / 2, y0, d / 2, false);
    // another floor: up or down by a storey, looking the same way
    const off = useGame.subscribe((s, was) => {
      if (s.floor === was.floor) return;
      const dy = (s.floor - was.floor) * STOREY;
      const t = cc.getTarget(new THREE.Vector3());
      const p = cc.getPosition(new THREE.Vector3());
      onFloor(s.floor * STOREY);
      void cc.setLookAt(p.x, p.y + dy, p.z, t.x, s.floor * STOREY, t.z, true);
    });
    // Handy for poking at the camera from the console while developing.
    if (import.meta.env.DEV) (window as unknown as { __camera: CameraControlsImpl }).__camera = cc;
    return () => {
      off();
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

    // Only gestures over the 3D view; the HUD's own lists still scroll.
    const onCanvas = (t: EventTarget | null) => t instanceof Element && t.closest(".scene") !== null;
    const stopFollowing = () => useGame.getState().follow && useGame.setState({ follow: false });

    // Trackpads: two fingers pan, pinch zooms toward the pointer. A mouse wheel still zooms.
    const passOn = new WeakSet<WheelEvent>();
    let stream = { at: 0, trackpad: false };
    const wheel = (e: WheelEvent) => {
      const c = ref.current;
      if (!c || passOn.has(e) || !onCanvas(e.target)) return;
      if (e.ctrlKey) {
        // A pinch. The controls would change the lens for this; send it on as a plain wheel so it moves the camera.
        e.preventDefault();
        e.stopPropagation();
        if (safariGesture) return;
        c.mouseButtons.wheel = ACTION.DOLLY;
        const again = new WheelEvent("wheel", { deltaY: e.deltaY * 2, deltaMode: 0, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true });
        passOn.add(again);
        e.target!.dispatchEvent(again);
        return;
      }
      // Decide once per burst of events, so a scroll's glide at the end doesn't flip between pan and zoom.
      if (e.timeStamp - stream.at > 250) stream = { at: 0, trackpad: fromTrackpad(e) };
      stream.at = e.timeStamp;
      c.mouseButtons.wheel = stream.trackpad ? ACTION.SCREEN_PAN : ACTION.DOLLY;
      if (stream.trackpad) stopFollowing();
    };

    // Safari tells us about trackpad pinches and twists directly.
    let safariGesture: { rotation: number; distance: number } | null = null;
    type Gesture = Event & { rotation: number; scale: number };
    const gestureStart = (e: Event) => {
      const c = ref.current;
      if (!c || !onCanvas(e.target)) return;
      e.preventDefault();
      safariGesture = { rotation: 0, distance: c.distance };
    };
    const gestureChange = (e: Event) => {
      const c = ref.current;
      const g = e as Gesture;
      if (!c || !safariGesture) return;
      e.preventDefault();
      void c.rotate(THREE.MathUtils.degToRad(g.rotation - safariGesture.rotation), 0, false);
      safariGesture.rotation = g.rotation;
      void c.dollyTo(safariGesture.distance / Math.max(g.scale, 0.05), false);
    };
    const gestureEnd = (e: Event) => {
      if (!safariGesture) return;
      e.preventDefault();
      safariGesture = null;
    };

    // Touchscreens: the controls already pan and pinch with two fingers; twisting them turns the view too.
    let twist: { angle: number; turning: boolean } | null = null;
    const pairAngle = () => {
      const [a, b] = [...touches.values()];
      return twistOf(a!, b!);
    };
    const touchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !onCanvas(e.target)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      twist = touches.size === 2 ? { angle: pairAngle(), turning: false } : null;
    };
    const touchMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = ref.current;
      if (!twist || !c || touches.size !== 2) return;
      let delta = pairAngle() - twist.angle;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      if (!twist.turning && Math.abs(delta) < TWIST_DEADZONE) return;
      twist = { angle: pairAngle(), turning: true };
      void c.rotate(delta, 0, false);
      stopFollowing();
    };
    const touchUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) twist = null;
    };

    // Capture, so these run before the controls and the build tools see the same events.
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("gesturestart", gestureStart, { capture: true });
    window.addEventListener("gesturechange", gestureChange, { capture: true });
    window.addEventListener("gestureend", gestureEnd, { capture: true });
    window.addEventListener("pointerdown", touchDown, { capture: true });
    window.addEventListener("pointermove", touchMove, { capture: true });
    window.addEventListener("pointerup", touchUp, { capture: true });
    window.addEventListener("pointercancel", touchUp, { capture: true });
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
      window.removeEventListener("wheel", wheel, { capture: true });
      window.removeEventListener("gesturestart", gestureStart, { capture: true });
      window.removeEventListener("gesturechange", gestureChange, { capture: true });
      window.removeEventListener("gestureend", gestureEnd, { capture: true });
      window.removeEventListener("pointerdown", touchDown, { capture: true });
      window.removeEventListener("pointermove", touchMove, { capture: true });
      window.removeEventListener("pointerup", touchUp, { capture: true });
      window.removeEventListener("pointercancel", touchUp, { capture: true });
      touches.clear();
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
    else if (follow && cameraFollow.target) void c.moveTo(cameraFollow.target.x, useGame.getState().floor * STOREY, cameraFollow.target.z, true);
  });

  return <CameraControls ref={setCc} makeDefault />;
}
