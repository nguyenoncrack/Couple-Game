import type { AppliedOp, Blueprint, LifeState } from "@cg/shared";

/**
 * Everything the server keeps on disk goes through this interface, so SQLite can be swapped for Postgres later
 * without touching rooms or routes. Methods are async for that reason even though SQLite answers synchronously.
 *
 * A house is saved as a snapshot plus an append-only log of ops after it. Every accepted op is written before
 * anyone hears about it, so a crash never loses a confirmed edit.
 */

export interface HouseRow {
  id: string;
  name: string;
  inviteCode: string;
  maxMembers: number;
}

export interface MemberRow {
  id: string;
  houseId: string;
  name: string;
  color: string;
  role: "owner" | "partner";
}

export interface Snapshot {
  version: number;
  blueprint: Blueprint;
}

export type AddMemberResult = "added" | "full";

export interface Store {
  createHouse(house: HouseRow, snapshot: Snapshot, owner: MemberRow, tokenHash: string): Promise<void>;
  getHouse(id: string): Promise<HouseRow | null>;
  findHouseByCode(code: string): Promise<HouseRow | null>;

  listMembers(houseId: string): Promise<MemberRow[]>;
  /** Adds a member unless the house is already full; checked and written in one transaction. */
  addMember(member: MemberRow, tokenHash: string): Promise<AddMemberResult>;
  memberByToken(houseId: string, tokenHash: string): Promise<MemberRow | null>;

  loadSnapshot(houseId: string): Promise<Snapshot | null>;
  saveSnapshot(houseId: string, snapshot: Snapshot): Promise<void>;
  appendOp(houseId: string, op: AppliedOp): Promise<void>;
  /** Ops with version > `after`, oldest first, at most `limit`. */
  opsSince(houseId: string, after: number, limit: number): Promise<AppliedOp[]>;
  /** The version an op with this client ID was applied at, if it was. */
  findClientOp(houseId: string, memberId: string, clientOpId: string): Promise<number | null>;
  /** Drop log entries at or below this version (they're covered by a snapshot). */
  pruneOps(houseId: string, upTo: number): Promise<void>;

  /** Where everyone was and what was cooking. Not part of the house's history: it's simply overwritten. */
  loadLife(houseId: string): Promise<LifeState | null>;
  saveLife(houseId: string, life: LifeState): Promise<void>;

  close(): void;
}
