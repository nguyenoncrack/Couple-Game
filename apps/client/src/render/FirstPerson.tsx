import { faceDir, floorOf, positionAt, STOREY } from "@cg/shared";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { act, serverNow, setFirstPerson, useGame } from "../state/game";
import { openObjectMenu } from "../tools/LiveTools";
import { cameraFollow } from "./CameraRig";
import { captureFirstPersonMouse, releaseFirstPersonMouse, retainFirstPersonMouse, useFirstPersonMouse } from "../input/firstPersonMouse";
import { firstPersonDirection, firstPersonEye, smoothFirstPersonEye, type Eye } from "../input/firstPersonMotion";
import { objectTransform } from "./House";

/**
 * Seeing the house through your own eyes, in Live mode.
 *  - walk: W A S D, or ↑ ↓ (← → turn)
 *  - look: move the captured mouse; no dragging, scrolling or click-to-walk
 *  - E or left click: use what is ahead, releasing the cursor for its menu
 *  - V: back to the usual camera; Esc: release the cursor and pause until you click to resume
 * Walking sends the server a short step ahead every so often while a key is held, so the character (and your
 * partner's view of them) moves the same way as any other walk. The camera sits at the character's eyes.
 */

const FOV = 70;
/** Turning with the arrow keys (radians a second), and with a drag (radians a pixel). */
const TURN_SPEED = 1.9;
const LOOK = 0.0022;
const PITCH_MAX = 1.35;
/** Each step aims this far ahead, sent this often while you keep going (and soon after you change direction). */
const LEAD = 0.75;
const SEND_MS = 140;
const MIN_SEND_MS = 50;
/** How far you can reach to use something, and how near the middle of the view it has to be (cosine). */
const REACH = 2.6;
const AIM = 0.7;

const typing = (e: Event) => e.target instanceof HTMLElement && (e.target.isContentEditable || Boolean(e.target.closest("input, textarea, select")));
const onCanvas = (t: EventTarget | null) => t instanceof Element && t.closest(".scene") !== null;

/** Me, where the server says I am right now. */
function myPosition() {
  const s = useGame.getState();
  const a = s.me ? s.life?.avatars[s.me] : undefined;
  return a ? positionAt(a, serverNow()) : null;
}

/** Open the menu for whatever's nearest the middle of the view and within reach. */
function openWhatsAhead(yaw: number, eye: Eye) {
  const s = useGame.getState();
  const me = s.me ? s.life?.avatars[s.me] : undefined;
  const at = me ? floorOf(me) : 0;
  const level = s.view?.levels[at];
  if (!level || !s.life || !s.me || !eye) return;
  const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
  const options: { score: number; open: () => boolean }[] = [];
  const consider = (x: number, z: number, near: number, open: () => boolean) => {
    const dx = x - eye.x;
    const dz = z - eye.z;
    const len = Math.hypot(dx, dz) || 1;
    const aim = (dx * fx + dz * fz) / len;
    if (near <= REACH && aim >= AIM) options.push({ score: near + (1 - aim) * 4, open });
  };
  const now = serverNow();
  for (const a of Object.values(s.life.avatars)) {
    if (a.memberId === s.me || floorOf(a) !== at) continue;
    const p = positionAt(a, now);
    consider(p.x, p.z, Math.hypot(p.x - eye.x, p.z - eye.z), () => {
      useGame.setState({ menu: { memberId: a.memberId, at: [p.x, p.y + 2.3, p.z] } });
      return true;
    });
  }
  for (const d of s.life.dishes.filter((d) => (d.level ?? 0) === at))
    consider(d.x, d.z, Math.hypot(d.x - eye.x, d.z - eye.z) - 0.3, () => {
      useGame.setState({ menu: { dishId: d.id, at: [d.x, at * STOREY + 1.2, d.z] } });
      return true;
    });
  for (const o of Object.values(level.objects)) {
    const { f } = objectTransform(o);
    // the nearest edge of the footprint, so you can reach a long sofa from its end
    const nx = Math.max(f.x, Math.min(eye.x, f.x + f.w));
    const nz = Math.max(f.z, Math.min(eye.z, f.z + f.d));
    consider(f.x + f.w / 2, f.z + f.d / 2, Math.hypot(nx - eye.x, nz - eye.z), () => openObjectMenu(level, o.id));
  }
  options.sort((a, b) => a.score - b.score);
  for (const o of options) if (o.open()) return;
}

export function FirstPersonRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const canvas = useThree((s) => s.gl.domElement);
  const look = useRef({ yaw: 0, pitch: -0.1 });
  const keys = useRef(new Set<string>());
  const eye = useRef<Eye | null>(null);
  const sent = useRef({ at: 0, dir: [0, 0] as [number, number], moving: false });

  useEffect(() => {
    const releaseRig = retainFirstPersonMouse();
    const s = useGame.getState();
    const a = s.me ? s.life?.avatars[s.me] : undefined;
    if (a) {
      const [dx, dz] = faceDir(a.use?.pose?.face ?? a.face);
      look.current.yaw = Math.atan2(dx, dz);
    }
    eye.current = null;
    const { fov, near } = camera;
    camera.fov = FOV;
    camera.near = 0.03;
    camera.updateProjectionMatrix();

    const locked = () => document.pointerLockElement === canvas;
    const paused = () => {
      const state = useGame.getState();
      return !locked() || Boolean(state.menu) || state.chatOpen || state.status !== "online";
    };
    const stop = () => {
      keys.current.clear();
      if (!sent.current.moving) return;
      sent.current = { at: performance.now(), dir: [0, 0], moving: false };
      const p = myPosition();
      if (p && useGame.getState().status === "online") act({ do: "move", x: p.x, z: p.z });
    };
    const pause = () => {
      stop();
      releaseFirstPersonMouse();
    };
    const useAhead = () => {
      // Stop before opening the menu: movement intents normally close the current menu.
      stop();
      openWhatsAhead(look.current.yaw, camera.position);
      if (useGame.getState().menu) pause();
    };
    let firstMouseEvent = true;
    const lockChange = () => {
      const active = locked();
      firstMouseEvent = true;
      useFirstPersonMouse.setState({ locked: active, error: null });
      if (!active) stop();
    };
    const lockError = () => {
      stop();
      useFirstPersonMouse.setState({ locked: false, error: "Mouse capture was blocked by the browser. Press V to return." });
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "escape") {
        pause();
        useGame.setState({ menu: null });
        return;
      }
      if (paused()) return;
      if (key === "e" && !e.repeat) useAhead();
      if (key.startsWith("arrow") || key === " ") e.preventDefault();
      keys.current.add(key);
    };
    const up = (e: KeyboardEvent) => void keys.current.delete(e.key.toLowerCase());
    const mouseMove = (e: MouseEvent) => {
      if (paused()) return;
      // Browsers can emit a cursor-warp delta when capture starts. It isn't a look gesture.
      if (firstMouseEvent) { firstMouseEvent = false; return; }
      if (!Number.isFinite(e.movementX) || !Number.isFinite(e.movementY)) return;
      look.current.yaw -= e.movementX * LOOK;
      look.current.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, look.current.pitch - e.movementY * LOOK));
    };
    const pointerDown = (e: PointerEvent) => {
      if (!locked() && !onCanvas(e.target)) return;
      if (e.pointerType === "touch" || e.button !== 0) return;
      // First-person clicks acquire capture or use the crosshair target; they never issue walk-to commands.
      e.preventDefault();
      e.stopImmediatePropagation();
      const state = useGame.getState();
      if (state.menu || state.chatOpen || state.status !== "online") return;
      if (locked()) useAhead();
      else captureFirstPersonMouse(canvas);
    };
    const wheel = (e: WheelEvent) => {
      if (!locked() && !onCanvas(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const focus = (e: FocusEvent) => { if (typing(e)) pause(); };
    const visibility = () => { if (document.hidden) pause(); };
    const unsubscribe = useGame.subscribe((state) => {
      if (state.menu || state.chatOpen || state.status !== "online") pause();
    });

    document.addEventListener("pointerlockchange", lockChange);
    document.addEventListener("pointerlockerror", lockError);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", pause);
    window.addEventListener("focusin", focus);
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("pointerdown", pointerDown, { capture: true });
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    lockChange();
    return () => {
      unsubscribe();
      document.removeEventListener("pointerlockchange", lockChange);
      document.removeEventListener("pointerlockerror", lockError);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("pointerdown", pointerDown, { capture: true });
      window.removeEventListener("wheel", wheel, { capture: true });
      stop();
      releaseRig();
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    };
  }, [camera, canvas]);

  useFrame((_, dt) => {
    const state = useGame.getState();
    const avatar = state.me ? state.life?.avatars[state.me] : undefined;
    const k = keys.current;
    const active = document.pointerLockElement === canvas && !state.menu && !state.chatOpen && state.status === "online";
    if (!active) k.clear();
    const l = look.current;
    l.yaw += ((k.has("arrowleft") ? 1 : 0) - (k.has("arrowright") ? 1 : 0)) * TURN_SPEED * Math.min(dt, 0.1);

    if (avatar) {
      const target = firstPersonEye(avatar, serverNow(), cameraFollow.eye);
      eye.current = smoothFirstPersonEye(eye.current, target, dt);
      camera.position.set(eye.current.x, eye.current.y, eye.current.z);
    }
    const flat = Math.cos(l.pitch);
    camera.lookAt(camera.position.x + Math.sin(l.yaw) * flat, camera.position.y + Math.sin(l.pitch), camera.position.z + Math.cos(l.yaw) * flat);

    const [mx, mz] = firstPersonDirection(k, l.yaw);
    const s = sent.current;
    const now = performance.now();
    if (mx || mz) {
      const turned = Math.hypot(mx - s.dir[0], mz - s.dir[1]) > 0.2;
      if (now - s.at < MIN_SEND_MS || (s.moving && !turned && now - s.at < SEND_MS)) return;
      const p = myPosition();
      const lot = state.view?.lot;
      if (!p || !lot) return;
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
      act({ do: "move", x: clamp(p.x + mx * LEAD, lot.w), z: clamp(p.z + mz * LEAD, lot.d) });
      sent.current = { at: now, dir: [mx, mz], moving: true };
    } else if (s.moving) {
      const p = myPosition();
      if (p && state.status === "online") act({ do: "move", x: p.x, z: p.z });
      sent.current = { at: now, dir: [0, 0], moving: false };
    }
  });

  return null;
}
