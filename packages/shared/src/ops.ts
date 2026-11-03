import { z } from "zod";

/**
 * Every change to a house is one of these ops. They are small and name exactly what they touch (by edge, cell or
 * object ID), so two people editing different things never collide, and replaying the log rebuilds the house.
 */

export const Id = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/);

const level = z.number().int().min(0).max(7);
const dir = z.enum(["h", "v"]);
const rot = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const coord = z.number().int().min(-1000).max(1000);
const edgeList = z.array(z.string().max(16)).min(1).max(512);
const cellList = z.array(z.string().max(12)).min(1).max(1024);

const single = [
  z.object({ t: z.literal("walls.add"), level, edges: edgeList, style: z.string().max(40) }),
  /** Removing a wall also removes any door or window in it. */
  z.object({ t: z.literal("walls.remove"), level, edges: edgeList }),
  z.object({ t: z.literal("floor.paint"), level, cells: cellList, material: z.string().max(40).nullable() }),
  z.object({ t: z.literal("roof.paint"), level, cells: cellList, style: z.string().max(40).nullable() }),
  z.object({ t: z.literal("object.place"), level, id: Id, catalogId: z.string().max(40), x: coord, z: coord, rot }),
  z.object({ t: z.literal("object.move"), level, id: Id, x: coord, z: coord, rot }),
  z.object({ t: z.literal("object.remove"), level, id: Id }),
  z.object({ t: z.literal("opening.place"), level, id: Id, catalogId: z.string().max(40), dir, x: coord, z: coord, flip: z.boolean() }),
  z.object({ t: z.literal("opening.move"), level, id: Id, dir, x: coord, z: coord, flip: z.boolean() }),
  z.object({ t: z.literal("opening.remove"), level, id: Id }),
] as const;

/** One edit. */
export const SingleOp = z.discriminatedUnion("t", [...single]);
export type SingleOp = z.infer<typeof SingleOp>;

/**
 * An op is one edit, or a batch of them that succeeds or fails as a whole (a starter house, an undo that touches
 * several kinds of thing).
 */
export const Op = z.discriminatedUnion("t", [...single, z.object({ t: z.literal("batch"), ops: z.array(SingleOp).min(1).max(400) })]);

export type Op = z.infer<typeof Op>;
