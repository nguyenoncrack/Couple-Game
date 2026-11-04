import type { Appearance, AppliedOp, Blueprint, ChatMessage, Day, LifeState, Visit, VisitResult } from "@cg/shared";

/**
 * Everything the server keeps goes through two interfaces, so the same rooms and routes run on Node with one SQLite
 * file (local play) and on Cloudflare, where each house is a Durable Object with its own SQLite and one more
 * Durable Object keeps the directory. Methods are async because a call may cross from one object to another.
 *
 * - The directory: accounts, sign-in sessions, houses and who's in them.
 * - A house store: one house's snapshot plus an append-only log of ops after it, and its life state. Every accepted
 *   op is written before anyone hears about it, so a crash never loses a confirmed edit.
 */

export interface AccountRow {
  id: string;
  name: string;
}

export interface HouseRow {
  id: string;
  name: string;
  inviteCode: string;
  maxMembers: number;
}

export interface MemberRow {
  appearance?: Appearance | null;
  id: string;
  houseId: string;
  /** Null for a member from before accounts who hasn't signed in on that browser since. */
  accountId: string | null;
  name: string;
  color: string;
  role: "owner" | "partner";
}

export interface Snapshot {
  version: number;
  blueprint: Blueprint;
}

export type AddMemberResult = "added" | "full" | "already";

export interface Directory {
  getAppearance(accountId: string): Promise<Appearance | null>;
  setAppearance(accountId: string, appearance: Appearance): Promise<void>;
  /** False if the name is taken (names are unique ignoring case and extra spaces). */
  createAccount(account: AccountRow, passwordHash: string): Promise<boolean>;
  accountByName(name: string): Promise<(AccountRow & { passwordHash: string }) | null>;
  setPassword(accountId: string, passwordHash: string): Promise<void>;

  createSession(tokenHash: string, accountId: string): Promise<void>;
  accountBySession(tokenHash: string): Promise<AccountRow | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Sign out everywhere else (after a password change). */
  deleteOtherSessions(accountId: string, keepTokenHash: string): Promise<void>;

  /** Throws if the invite code is already used (the caller draws another). */
  createHouse(house: HouseRow, owner: MemberRow): Promise<void>;
  getHouse(id: string): Promise<HouseRow | null>;
  findHouseByCode(code: string): Promise<HouseRow | null>;
  deleteHouse(id: string): Promise<void>;

  listMembers(houseId: string): Promise<MemberRow[]>;
  /** Adds a member unless the house is full or they're already in it; checked and written together. */
  addMember(member: MemberRow): Promise<AddMemberResult>;
  memberFor(houseId: string, accountId: string): Promise<MemberRow | null>;
  /** The houses an account is in, newest first. */
  housesFor(accountId: string): Promise<{ house: HouseRow; members: MemberRow[] }[]>;
  /** A browser from before accounts proves it's a member with its old token; that member becomes this account's. */
  claimMember(houseId: string, tokenHash: string, accountId: string): Promise<MemberRow | null>;
  /** Leave a house. Returns how many members are left. */
  removeMember(houseId: string, accountId: string): Promise<number>;

  /**
   * Count a member's visit on their own calendar day, with what it brings (see visits.ts), checked and written
   * together. Null if that day is already counted, comes before their last visit, or the member has no account.
   */
  recordVisit(houseId: string, memberId: string, day: Day): Promise<VisitResult | null>;
  /** Every day an account has visited, oldest first. */
  visitsFor(accountId: string): Promise<Visit[]>;
}

export interface HouseStore {
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

  /** Keep something said in the house, dropping the oldest beyond `keep`. */
  appendChat(houseId: string, message: ChatMessage, keep: number): Promise<void>;
  /** The last `limit` things said, oldest first. */
  recentChat(houseId: string, limit: number): Promise<ChatMessage[]>;

  /** Forget a house entirely (its last member left). */
  deleteHouse(houseId: string): Promise<void>;
}
