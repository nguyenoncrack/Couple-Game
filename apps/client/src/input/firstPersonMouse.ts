import { create } from "zustand";

/** Pointer lock is local browser input, separate from the shared house and character state. */
export const useFirstPersonMouse = create<{ locked: boolean; error: string | null }>(() => ({ locked: false, error: null }));
let requestId = 0;
let mountedRigs = 0;

/** StrictMode immediately remounts effects in development; don't cancel the entry gesture between those mounts. */
export function retainFirstPersonMouse() {
  mountedRigs++;
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    mountedRigs--;
    queueMicrotask(() => {
      if (mountedRigs === 0) releaseFirstPersonMouse();
    });
  };
}

/** Call directly from a click or keypress so browsers can honour the user's mouse-capture request. */
export function captureFirstPersonMouse(canvas = document.querySelector<HTMLCanvasElement>(".scene canvas")) {
  if (!canvas || document.pointerLockElement === canvas) return;
  if (!canvas.requestPointerLock) {
    useFirstPersonMouse.setState({ error: "Mouse capture is unavailable in this browser. Press V to step out." });
    return;
  }
  const id = ++requestId;
  useFirstPersonMouse.setState({ error: null });
  try {
    // Older implementations return void; the document events report success/failure in both versions.
    const result = canvas.requestPointerLock();
    result?.then(() => {
      if (id !== requestId && document.pointerLockElement === canvas) document.exitPointerLock();
    }).catch(() => {
      if (id === requestId) useFirstPersonMouse.setState({ error: "Mouse capture was blocked by the browser. Press V to return." });
    });
  } catch {
    useFirstPersonMouse.setState({ error: "Mouse capture was blocked by the browser. Press V to return." });
  }
}

export function releaseFirstPersonMouse() {
  requestId++;
  if (document.pointerLockElement) document.exitPointerLock();
  useFirstPersonMouse.setState({ locked: false });
}
