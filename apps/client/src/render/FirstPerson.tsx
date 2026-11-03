import { faceDir, positionAt } from "@cg/shared";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { act, serverNow, setFirstPerson, useGame } from "../state/game";
import { openObjectMenu } from "../tools/LiveTools";
import { cameraFollow } from "./CameraRig";
import { objectTransform } from "./House";

/**
 * Seeing the house through your own eyes, in Live mode.
 *  - walk: W A S D, or ↑ ↓ (← → turn)
 *  - look: drag with the right mouse button (or Option + drag), two fingers on a trackpad or a touchscreen
 *  - E: use what you're looking at (furniture, a plate, your partner); clicking things works as usual too
 *  - V or Esc: back to the usual camera
 * Walking sends the server a short step ahead every so often while a key is held, so the character (and your
 * partner's view of them) moves the same way as any other walk. The camera sits at the character's eyes.
 */

const FOV = 70;
/** Turning with the arrow keys (radians a second), and with a drag (radians a pixel). */
const TURN_SPEED = 1.9;
const LOOK = 0.0045;
const PITCH_MAX = 1.35;
/** Each step aims this far ahead, sent this often while you keep going (and soon after you change direction). */
const LEAD = 0.75;
const SEND_MS = 140;
const MIN_SEND_MS = 50;
/** How far you can reach to use something, and how near the middle of the view it has to be (cosine). */
const REACH = 2.6;
const AIM = 0.7;

const typing = (e: Event) => e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
const onCanvas = (t: EventTarget | null) => t instanceof Element && t.closest(".scene") !== null;

/** Me, where the server says I am right now. */
function myPosition() {
  const s = useGame.getState();
  const a = s.me ? s.life?.avatars[s.me] : undefined;
  return a ? positionAt(a, serverNow()) : null;
}

/** Open the menu for whatever's nearest the middle of the view and within reach. */
function openWhatsAhead(yaw: number) {
  const s = useGame.getState();
  const level = s.view?.levels[0];
  const eye = cameraFollow.eye;
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
    if (a.memberId === s.me) continue;
    const p = positionAt(a, now);
    consider(p.x, p.z, Math.hypot(p.x - eye.x, p.z - eye.z), () => {
      useGame.setState({ menu: { memberId: a.memberId, at: [p.x, 2.3, p.z] } });
      return true;
    });
  }
  for (const d of s.life.dishes)
    consider(d.x, d.z, Math.hypot(d.x - eye.x, d.z - eye.z) - 0.3, () => {
      useGame.setState({ menu: { dishId: d.id, at: [d.x, 1.2, d.z] } });
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
  const look = useRef({ yaw: 0, pitch: -0.1 });
  const keys = useRef(new Set<string>());
  const sent = useRef({ at: 0, dir: [0, 0] as [number, number], moving: false });

  useEffect(() => {
    // start out looking the way you face
    const s = useGame.getState();
    const a = s.me ? s.life?.avatars[s.me] : undefined;
    if (a) {
      const [dx, dz] = faceDir(a.use?.pose?.face ?? a.face);
      look.current.yaw = Math.atan2(dx, dz);
    }
    const { fov, near } = camera;
    camera.fov = FOV;
    // close up to a wall, nothing should get cut away in front of your nose
    camera.near = 0.03;
    camera.updateProjectionMatrix();

    const turn = (dx: number, dy: number) => {
      const l = look.current;
      l.yaw -= dx * LOOK;
      l.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, l.pitch - dy * LOOK));
    };

    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        // Esc closes a menu first, then takes you out of your eyes
        if (!useGame.getState().menu) setFirstPerson(false);
        return;
      }
      if (k === "e" && !e.repeat) openWhatsAhead(look.current.yaw);
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => void keys.current.delete(e.key.toLowerCase());
    const clear = () => keys.current.clear();

    // look around: right-drag or Option + drag with a mouse, two fingers on a touchscreen
    let drag: { x: number; y: number } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    const centre = () => {
      const all = [...touches.values()];
      return { x: all.reduce((n, t) => n + t.x, 0) / all.length, y: all.reduce((n, t) => n + t.y, 0) / all.length };
    };
    const pointerDown = (e: PointerEvent) => {
      if (!onCanvas(e.target)) return;
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag = touches.size === 2 ? centre() : null;
      } else if (e.button === 2 || (e.button === 0 && e.altKey)) drag = { x: e.clientX, y: e.clientY };
    };
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!drag || touches.size !== 2) return;
        const c = centre();
        turn(c.x - drag.x, c.y - drag.y);
        drag = c;
      } else if (drag) {
        turn(e.clientX - drag.x, e.clientY - drag.y);
        drag = { x: e.clientX, y: e.clientY };
      }
    };
    const pointerUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (e.pointerType !== "touch" || touches.size < 2) drag = null;
    };
    // two fingers on a trackpad (or a mouse wheel) look around; a pinch does nothing
    const wheel = (e: WheelEvent) => {
      if (!onCanvas(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.ctrlKey) turn(e.deltaX * 0.6, e.deltaY * 0.6);
    };

    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    window.addEventListener("pointerdown", pointerDown, { capture: true });
    window.addEventListener("pointermove", pointerMove, { capture: true });
    window.addEventListener("pointerup", pointerUp, { capture: true });
    window.addEventListener("pointercancel", pointerUp, { capture: true });
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      window.removeEventListener("pointerdown", pointerDown, { capture: true });
      window.removeEventListener("pointermove", pointerMove, { capture: true });
      window.removeEventListener("pointerup", pointerUp, { capture: true });
      window.removeEventListener("pointercancel", pointerUp, { capture: true });
      window.removeEventListener("wheel", wheel, { capture: true });
      // stop where you are rather than carry on to the last step
      const p = sent.current.moving && myPosition();
      if (p) act({ do: "move", x: p.x, z: p.z });
    };
  }, [camera]);

  useFrame((_, dt) => {
    const k = keys.current;
    const l = look.current;
    l.yaw += ((k.has("arrowleft") ? 1 : 0) - (k.has("arrowright") ? 1 : 0)) * TURN_SPEED * Math.min(dt, 0.1);

    const eye = cameraFollow.eye;
    if (eye) camera.position.set(eye.x, eye.y, eye.z);
    const flat = Math.cos(l.pitch);
    camera.lookAt(camera.position.x + Math.sin(l.yaw) * flat, camera.position.y + Math.sin(l.pitch), camera.position.z + Math.cos(l.yaw) * flat);

    // walking: forward along where you look, sideways to its right
    const ahead = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const aside = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
    const [fx, fz] = [Math.sin(l.yaw), Math.cos(l.yaw)];
    let mx = fx * ahead - fz * aside;
    let mz = fz * ahead + fx * aside;
    const len = Math.hypot(mx, mz);
    const s = sent.current;
    const now = performance.now();
    if (len > 0) {
      mx /= len;
      mz /= len;
      const turned = Math.hypot(mx - s.dir[0], mz - s.dir[1]) > 0.2;
      if (now - s.at < MIN_SEND_MS || (s.moving && !turned && now - s.at < SEND_MS)) return;
      const p = myPosition();
      const lot = useGame.getState().view?.lot;
      if (!p || !lot) return;
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
      act({ do: "move", x: clamp(p.x + mx * LEAD, lot.w), z: clamp(p.z + mz * LEAD, lot.d) });
      sent.current = { at: now, dir: [mx, mz], moving: true };
    } else if (s.moving) {
      const p = myPosition();
      if (p) act({ do: "move", x: p.x, z: p.z });
      sent.current = { at: now, dir: [0, 0], moving: false };
    }
  });

  return null;
}
