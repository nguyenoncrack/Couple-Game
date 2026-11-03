import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppliedOp, Blueprint, LifeState, Op } from "@cg/shared";
import type { AddMemberResult, HouseRow, MemberRow, Snapshot, Store } from "./store";

const SCHEMA = `
  create table if not exists houses (
    id text primary key,
    name text not null,
    invite_code text not null unique,
    max_members integer not null,
    snapshot_version integer not null,
    snapshot text not null,
    created_at integer not null
  );
  create table if not exists members (
    id text primary key,
    house_id text not null references houses(id) on delete cascade,
    name text not null,
    color text not null,
    role text not null,
    token_hash text not null unique,
    joined_at integer not null
  );
  create index if not exists members_house on members(house_id);
  create table if not exists ops (
    house_id text not null references houses(id) on delete cascade,
    version integer not null,
    member_id text not null,
    client_op_id text not null,
    op text not null,
    at integer not null,
    primary key (house_id, version)
  );
  create unique index if not exists ops_client on ops(house_id, member_id, client_op_id);
  create table if not exists life (
    house_id text primary key references houses(id) on delete cascade,
    state text not null,
    updated_at integer not null
  );
`;

type Row = Record<string, unknown>;

const house = (r: Row): HouseRow => ({ id: r.id as string, name: r.name as string, inviteCode: r.invite_code as string, maxMembers: r.max_members as number });
const member = (r: Row): MemberRow => ({ id: r.id as string, houseId: r.house_id as string, name: r.name as string, color: r.color as string, role: r.role as MemberRow["role"] });

export class SqliteStore implements Store {
  private db: DatabaseSync;

  /** `path` is a file, or ":memory:" for tests. */
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;");
    this.db.exec(SCHEMA);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("begin immediate");
    try {
      const out = fn();
      this.db.exec("commit");
      return out;
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    }
  }

  async createHouse(h: HouseRow, s: Snapshot, owner: MemberRow, tokenHash: string) {
    this.tx(() => {
      this.db
        .prepare("insert into houses (id, name, invite_code, max_members, snapshot_version, snapshot, created_at) values (?, ?, ?, ?, ?, ?, ?)")
        .run(h.id, h.name, h.inviteCode, h.maxMembers, s.version, JSON.stringify(s.blueprint), Date.now());
      this.insertMember(owner, tokenHash);
    });
  }

  private insertMember(m: MemberRow, tokenHash: string) {
    this.db
      .prepare("insert into members (id, house_id, name, color, role, token_hash, joined_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(m.id, m.houseId, m.name, m.color, m.role, tokenHash, Date.now());
  }

  async getHouse(id: string) {
    const r = this.db.prepare("select * from houses where id = ?").get(id) as Row | undefined;
    return r ? house(r) : null;
  }

  async findHouseByCode(code: string) {
    const r = this.db.prepare("select * from houses where invite_code = ?").get(code) as Row | undefined;
    return r ? house(r) : null;
  }

  async listMembers(houseId: string) {
    return (this.db.prepare("select * from members where house_id = ? order by joined_at").all(houseId) as Row[]).map(member);
  }

  async addMember(m: MemberRow, tokenHash: string): Promise<AddMemberResult> {
    return this.tx(() => {
      const h = this.db.prepare("select max_members from houses where id = ?").get(m.houseId) as Row | undefined;
      const { n } = this.db.prepare("select count(*) as n from members where house_id = ?").get(m.houseId) as { n: number };
      if (!h || n >= (h.max_members as number)) return "full";
      this.insertMember(m, tokenHash);
      return "added";
    });
  }

  async memberByToken(houseId: string, tokenHash: string) {
    const r = this.db.prepare("select * from members where house_id = ? and token_hash = ?").get(houseId, tokenHash) as Row | undefined;
    return r ? member(r) : null;
  }

  async loadSnapshot(houseId: string) {
    const r = this.db.prepare("select snapshot_version, snapshot from houses where id = ?").get(houseId) as Row | undefined;
    return r ? { version: r.snapshot_version as number, blueprint: JSON.parse(r.snapshot as string) as Blueprint } : null;
  }

  async saveSnapshot(houseId: string, s: Snapshot) {
    this.db.prepare("update houses set snapshot_version = ?, snapshot = ? where id = ?").run(s.version, JSON.stringify(s.blueprint), houseId);
  }

  async appendOp(houseId: string, a: AppliedOp) {
    this.db
      .prepare("insert into ops (house_id, version, member_id, client_op_id, op, at) values (?, ?, ?, ?, ?, ?)")
      .run(houseId, a.version, a.by, a.clientOpId, JSON.stringify(a.op), Date.now());
  }

  async opsSince(houseId: string, after: number, limit: number) {
    const rows = this.db
      .prepare("select version, member_id, client_op_id, op from ops where house_id = ? and version > ? order by version limit ?")
      .all(houseId, after, limit) as Row[];
    return rows.map((r) => ({ version: r.version as number, by: r.member_id as string, clientOpId: r.client_op_id as string, op: JSON.parse(r.op as string) as Op }));
  }

  async findClientOp(houseId: string, memberId: string, clientOpId: string) {
    const r = this.db.prepare("select version from ops where house_id = ? and member_id = ? and client_op_id = ?").get(houseId, memberId, clientOpId) as Row | undefined;
    return r ? (r.version as number) : null;
  }

  async pruneOps(houseId: string, upTo: number) {
    this.db.prepare("delete from ops where house_id = ? and version <= ?").run(houseId, upTo);
  }

  async loadLife(houseId: string) {
    const r = this.db.prepare("select state from life where house_id = ?").get(houseId) as Row | undefined;
    return r ? (JSON.parse(r.state as string) as LifeState) : null;
  }

  async saveLife(houseId: string, life: LifeState) {
    this.db
      .prepare("insert into life (house_id, state, updated_at) values (?, ?, ?) on conflict(house_id) do update set state = excluded.state, updated_at = excluded.updated_at")
      .run(houseId, JSON.stringify(life), Date.now());
  }

  close() {
    this.db.close();
  }
}
