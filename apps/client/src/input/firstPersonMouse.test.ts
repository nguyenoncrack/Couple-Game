import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureFirstPersonMouse, releaseFirstPersonMouse, useFirstPersonMouse } from "./firstPersonMouse";

let doc: { pointerLockElement: unknown; exitPointerLock: ReturnType<typeof vi.fn>; querySelector: ReturnType<typeof vi.fn> };
beforeEach(() => {
  doc = { pointerLockElement: null, exitPointerLock: vi.fn(() => { doc.pointerLockElement = null; }), querySelector: vi.fn() };
  vi.stubGlobal("document", doc);
  useFirstPersonMouse.setState({ locked: false, error: null });
});
afterEach(() => { releaseFirstPersonMouse(); vi.unstubAllGlobals(); });

describe("first-person mouse capture", () => {
  it("requests capture directly from the entry gesture and releases it for the cursor", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const canvas = { requestPointerLock: request } as unknown as HTMLCanvasElement;
    doc.querySelector.mockReturnValue(canvas);
    captureFirstPersonMouse();
    expect(request).toHaveBeenCalledOnce();
    await Promise.resolve();
    doc.pointerLockElement = canvas;
    useFirstPersonMouse.setState({ locked: true });
    captureFirstPersonMouse(canvas);
    expect(request).toHaveBeenCalledOnce();
    releaseFirstPersonMouse();
    expect(doc.exitPointerLock).toHaveBeenCalledOnce();
    expect(useFirstPersonMouse.getState().locked).toBe(false);
  });

  it("handles older void-returning APIs and shows retry guidance if capture is refused", async () => {
    const canvas = { requestPointerLock: vi.fn() } as unknown as HTMLCanvasElement;
    expect(() => captureFirstPersonMouse(canvas)).not.toThrow();
    canvas.requestPointerLock = vi.fn().mockRejectedValue(new Error("denied"));
    captureFirstPersonMouse(canvas);
    await Promise.resolve(); await Promise.resolve();
    expect(useFirstPersonMouse.getState().error).toContain("Click");
    expect(useFirstPersonMouse.getState().locked).toBe(false);
  });

  it("doesn't trap the cursor if a pending capture completes after first person was left", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const canvas = { requestPointerLock: vi.fn(() => pending) } as unknown as HTMLCanvasElement;
    captureFirstPersonMouse(canvas);
    releaseFirstPersonMouse();
    doc.pointerLockElement = canvas;
    complete(); await pending; await Promise.resolve();
    expect(doc.exitPointerLock).toHaveBeenCalledOnce();
    expect(doc.pointerLockElement).toBeNull();
  });
});
