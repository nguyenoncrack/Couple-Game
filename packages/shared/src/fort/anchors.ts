import { rotatedSize, type Rot } from "../grid";
import { ANCHORS, FRAME_SIZE, type Anchor, type PieceRole } from "./definitions";

/** Where a frame stands (the cell of its corner, and how it's turned). */
export interface FramePlace {
  x: number;
  z: number;
  rot: Rot;
}

/** A snap point on a frame that's been placed: where a piece's footprint would go on the lot. */
export interface PlacedAnchor {
  anchor: Anchor;
  x: number;
  z: number;
  /** The footprint's size once turned. */
  w: number;
  d: number;
}

/** The frame's footprint on the lot, for a spot. */
export function frameRect(at: FramePlace) {
  const [w, d] = rotatedSize(FRAME_SIZE[0], FRAME_SIZE[1], at.rot);
  return { x: at.x, z: at.z, w, d };
}

/** A point in the frame's own frame (cells from its corner) to the lot: the same turn the model gets. */
function toLot(at: FramePlace, lx: number, lz: number): [number, number] {
  const f = frameRect(at);
  const vx = lx - FRAME_SIZE[0] / 2;
  const vz = lz - FRAME_SIZE[1] / 2;
  const a = (-at.rot * Math.PI) / 2;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  return [f.x + f.w / 2 + vx * c + vz * s, f.z + f.d / 2 - vx * s + vz * c];
}

/** Every snap point (or just those for one kind of piece) of a frame standing at `at`. */
export function anchorsAt(at: FramePlace, role?: PieceRole): PlacedAnchor[] {
  return ANCHORS.filter((a) => !role || a.role === role).map((anchor) => {
    const [cx, cz] = toLot(at, anchor.x + anchor.w / 2, anchor.z + anchor.d / 2);
    const [w, d] = rotatedSize(anchor.w, anchor.d, at.rot);
    return { anchor, x: Math.round(cx - w / 2), z: Math.round(cz - d / 2), w, d };
  });
}

/** Does a piece at this spot sit on this snap point? (Pieces that `turns` must face the way the frame does.) */
export const sitsOn = (p: PlacedAnchor, at: FramePlace, piece: { x: number; z: number; rot: Rot }) => piece.x === p.x && piece.z === p.z && (!p.anchor.turns || piece.rot === at.rot);
