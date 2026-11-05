import { activityAt, positionAt, type Avatar } from "@cg/shared";

export interface Eye { x: number; y: number; z: number }

/** Walking eyes stay level and independent of the avatar's gait, turning and render order. */
export function firstPersonEye(avatar: Avatar, now: number, posedEye: Eye | null): Eye {
  const activity = activityAt(avatar, now);
  if (activity !== "walk" && activity !== "idle" && avatar.use?.pose && posedEye) return posedEye;
  const p = positionAt(avatar, now);
  // level, at eye height over the floor they're on (or the step they're on)
  return { x: p.x, y: p.y + 1.64, z: p.z };
}

/** Filter small network corrections without feeding animated head motion back into the camera. */
export function smoothFirstPersonEye(current: Eye | null, target: Eye, dt: number): Eye {
  if (!current || dt > 0.25 || Math.hypot(current.x - target.x, current.y - target.y, current.z - target.z) > 1.5) return { ...target };
  const k = 1 - Math.exp(-Math.max(0, dt) * 24);
  return { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k, z: current.z + (target.z - current.z) * k };
}

/** Camera-relative WASD, normalised so diagonals aren't faster. */
export function firstPersonDirection(keys: ReadonlySet<string>, yaw: number): [number, number] {
  const ahead = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  const aside = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
  const x = fx * ahead - fz * aside, z = fz * ahead + fx * aside;
  const length = Math.hypot(x, z);
  return length ? [x / length, z / length] : [0, 0];
}
