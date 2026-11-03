import { z } from "zod";
import type { HouseState } from "./blueprint";
import type { Rot } from "./grid";
import { Id, Op } from "./ops";

/** Messages over the house WebSocket. Client messages are checked on the server; server messages are trusted. */

const Cursor = z.object({ x: z.number().finite(), z: z.number().finite() }).nullable();

/** Something a player is carrying around before they drop it: a catalog item or an object they're moving. */
const Drag = z
  .object({
    catalogId: z.string().max(40),
    objectId: Id.nullable(),
    x: z.number().int(),
    z: z.number().int(),
    rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  })
  .nullable();

export const ClientMsg = z.discriminatedUnion("type", [
  /** First message on every connection. `knownVersion` is the last version this client saw (0 if none). */
  z.object({ type: z.literal("hello"), houseId: Id, token: z.string().min(20).max(100), knownVersion: z.number().int().min(0) }),
  z.object({ type: z.literal("op"), clientOpId: Id, op: Op }),
  /** Claim (or release, with null) an object while dragging it, so the partner can't grab it at the same time. */
  z.object({ type: z.literal("hold"), objectId: Id.nullable() }),
  z.object({ type: z.literal("presence"), cursor: Cursor, tool: z.string().max(20), drag: Drag }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export interface MemberInfo {
  id: string;
  name: string;
  color: string;
  role: "owner" | "partner";
  online: boolean;
}

export interface AppliedOp {
  version: number;
  op: Op;
  by: string;
  clientOpId: string;
}

export interface Presence {
  memberId: string;
  cursor: { x: number; z: number } | null;
  tool: string;
  drag: { catalogId: string; objectId: string | null; x: number; z: number; rot: Rot } | null;
}

export type ServerMsg =
  | {
      type: "welcome";
      memberId: string;
      house: { id: string; name: string; inviteCode: string };
      members: MemberInfo[];
      holds: Record<string, string>;
      /** Either a full snapshot, or the ops the client missed since its `knownVersion`. */
      sync: { kind: "snapshot"; state: HouseState } | { kind: "ops"; ops: AppliedOp[] };
    }
  | ({ type: "applied" } & AppliedOp)
  /** The op with this client ID was already applied earlier (a resend after a reconnect). */
  | { type: "duplicate"; clientOpId: string }
  | { type: "rejected"; clientOpId: string; reason: string }
  | { type: "members"; members: MemberInfo[] }
  | ({ type: "presence" } & Presence)
  | { type: "holds"; holds: Record<string, string> }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

/** WebSocket close codes the client acts on. */
export const CLOSE = {
  /** Bad token or not a member: don't reconnect, send the player home. */
  unauthorized: 4401,
  /** The house no longer exists. */
  notFound: 4404,
  /** The same member connected from somewhere else; this tab yields. */
  replaced: 4409,
} as const;
