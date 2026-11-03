import { describe, expect, it } from "vitest";
import type { Avatar } from "@cg/shared";
import { firstPersonDirection, firstPersonEye, smoothFirstPersonEye } from "./firstPersonMotion";

const avatar: Avatar = { memberId: "amy", path: [[3, 3], [3, 8]], startedAt: 0, face: 0, use: null };

describe("first-person camera", () => {
  it("stays level while walking, independent of animated head bob, body rotation or render order", () => {
    for (let t = 0; t < 1500; t += 16) {
      const bobbingHead = { x: 100, y: 1.6 + Math.sin(t) * 0.03, z: 100 };
      const eye = firstPersonEye(avatar, t, bobbingHead);
      expect(eye.x).toBe(3);
      expect(eye.z).toBeCloseTo(3 + 2.2 * t / 1000);
      expect(eye.y).toBe(1.64);
    }
    expect(firstPersonEye(avatar, 10_000, null)).toEqual({ x: 3, y: 1.64, z: 8 });
  });

  it("still uses the posed eyes when seated rather than standing above the furniture", () => {
    const seated: Avatar = { ...avatar, path: [[3, 3]], use: { objectId: "chair", action: "sit", slot: 0, pose: { x: 3.5, z: 3.5, y: 0.45, face: 2 } } };
    expect(firstPersonEye(seated, 1000, { x: 3.5, y: 1.3, z: 3.45 })).toEqual({ x: 3.5, y: 1.3, z: 3.45 });
  });

  it("filters packet-sized position jumps instead of displaying them as camera jolts", () => {
    let eye = { x: 3, y: 1.64, z: 3 };
    let previousRaw = 3, maxRawStep = 0, maxDisplayedStep = 0;
    for (let i = 1; i <= 180; i++) {
      const target = { x: 3 + 2.2 * i / 60 + (i % 8 < 4 ? 0.03 : -0.03), y: 1.64, z: 3 };
      const next = smoothFirstPersonEye(eye, target, 1 / 60);
      maxRawStep = Math.max(maxRawStep, Math.abs(target.x - previousRaw));
      maxDisplayedStep = Math.max(maxDisplayedStep, Math.abs(next.x - eye.x));
      expect(next.y).toBe(1.64);
      eye = next;
      previousRaw = target.x;
    }
    expect(maxRawStep).toBeGreaterThan(0.09);
    expect(maxDisplayedStep).toBeLessThan(0.06);
  });

  it("smooths consistently at different frame rates and snaps after a teleport or long pause", () => {
    const target = { x: 1, y: 1.64, z: 0 };
    const finish = (fps: number) => {
      let eye = { x: 0, y: 1.64, z: 0 };
      for (let i = 0; i < fps / 4; i++) eye = smoothFirstPersonEye(eye, target, 1 / fps);
      return eye;
    };
    expect(finish(60).x).toBeCloseTo(finish(144).x, 8);
    expect(smoothFirstPersonEye(null, target, 0.016)).toEqual(target);
    expect(smoothFirstPersonEye({ x: 20, y: 1.64, z: 0 }, target, 0.016)).toEqual(target);
    expect(smoothFirstPersonEye({ x: 0, y: 1.64, z: 0 }, target, 2)).toEqual(target);
  });

  it("uses camera-relative WASD, cancels opposing keys and normalises diagonals", () => {
    expect(firstPersonDirection(new Set(["w"]), 0)).toEqual([0, 1]);
    expect(firstPersonDirection(new Set(["d"]), 0)).toEqual([-1, 0]);
    expect(firstPersonDirection(new Set(["w", "s", "a", "d"]), 1)).toEqual([0, 0]);
    const [x, z] = firstPersonDirection(new Set(["w"]), Math.PI / 2);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
    expect(Math.hypot(...firstPersonDirection(new Set(["w", "d"]), 0))).toBeCloseTo(1);
  });
});
