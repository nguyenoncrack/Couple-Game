import { AppearanceSchema, visitReward, type Appearance, type AppliedOp, type Blueprint, type ChatMessage, type Day, type LifeState, type LoggedOp, type Visit } from "@cg/shared";
import type { Row, Sql } from "./sql";
import type { AccountRow, AddMemberResult, Directory, HouseRow, HouseStore, MemberRow, Snapshot } from "./store";

/** The directory and house stores over any `Sql`: one Node file holding both, or Durable Objects holding one each. */

/** How names are compared: "Ana  Lee" and "ana lee" are the same person. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const house = (r: Row): HouseRow => ({ id: r.id as string, name: r.name as string, inviteCode: r.invite_code as string, maxMembers: r.max_members as number });
function readAppearance(value: unknown): Appearance | null {
  try { const parsed = AppearanceSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
const member = (r: Row): MemberRow => ({
  appearance: readAppearance(r.appearance),
  id: r.id as string,
  houseId: r.house_id as string,
  accountId: (r.account_id as string | null) ?? null,
  name: r.name as string,
  color: r.color as string,
  role: r.role as MemberRow["role"],
});

export class SqlDirectory implements Directory {
  constructor(private sql: Sql) {}

  async getAppearance(accountId: string) {
    return readAppearance(this.sql.get("select appearance from account_appearances where account_id = ?", accountId)?.appearance);
  }
  async setAppearance(accountId: string, appearance: Appearance) {
    this.sql.run("insert into account_appearances (account_id, appearance) values (?, ?) on conflict(account_id) do update set appearance = excluded.appearance", accountId, JSON.stringify(appearance));
  }

  async createAccount(a: AccountRow, passwordHash: string) {
    return this.sql.tx(() => {
      if (this.sql.get("select 1 from accounts where name_key = ?", nameKey(a.name))) return false;
      this.sql.run("insert into accounts (id, name, name_key, password, created_at) values (?, ?, ?, ?, ?)", a.id, a.name, nameKey(a.name), passwordHash, Date.now());
      return true;
    });
  }

  async accountByName(name: string) {
    const r = this.sql.get("select id, name, password from accounts where name_key = ?", nameKey(name));
    return r ? { id: r.id as string, name: r.name as string, passwordHash: r.password as string } : null;
  }

  async setPassword(accountId: string, passwordHash: string) {
    this.sql.run("update accounts set password = ? where id = ?", passwordHash, accountId);
  }

  async createSession(tokenHash: string, accountId: string) {
    this.sql.run("insert into sessions (token_hash, account_id, created_at) values (?, ?, ?)", tokenHash, accountId, Date.now());
  }

  async accountBySession(tokenHash: string) {
    const r = this.sql.get("select a.id, a.name from sessions s join accounts a on a.id = s.account_id where s.token_hash = ?", tokenHash);
    return r ? { id: r.id as string, name: r.name as string } : null;
  }

  async deleteSession(tokenHash: string) {
    this.sql.run("delete from sessions where token_hash = ?", tokenHash);
  }

  async deleteOtherSessions(accountId: string, keepTokenHash: string) {
    this.sql.run("delete from sessions where account_id = ? and token_hash != ?", accountId, keepTokenHash);
  }

  async createHouse(h: HouseRow, owner: MemberRow) {
    this.sql.tx(() => {
      this.sql.run("insert into houses (id, name, invite_code, max_members, created_at) values (?, ?, ?, ?, ?)", h.id, h.name, h.inviteCode, h.maxMembers, Date.now());
      this.insertMember(owner);
    });
  }

  private insertMember(m: MemberRow, tokenHash: string | null = null) {
    this.sql.run(
      "insert into members (id, house_id, account_id, name, color, role, token_hash, joined_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      m.id,
      m.houseId,
      m.accountId,
      m.name,
      m.color,
      m.role,
      tokenHash,
      Date.now(),
    );
  }

  async getHouse(id: string) {
    const r = this.sql.get("select * from houses where id = ?", id);
    return r ? house(r) : null;
  }

  async findHouseByCode(code: string) {
    const r = this.sql.get("select * from houses where invite_code = ?", code);
    return r ? house(r) : null;
  }

  async deleteHouse(id: string) {
    this.sql.tx(() => {
      this.sql.run("delete from members where house_id = ?", id);
      this.sql.run("delete from houses where id = ?", id);
    });
  }

  async listMembers(houseId: string) {
    return this.sql.all("select m.*, a.appearance from members m left join account_appearances a on a.account_id = m.account_id where m.house_id = ? order by m.joined_at, m.rowid", houseId).map(member);
  }

  async addMember(m: MemberRow): Promise<AddMemberResult> {
    return this.sql.tx(() => {
      const h = this.sql.get("select max_members from houses where id = ?", m.houseId);
      if (m.accountId && this.sql.get("select 1 from members where house_id = ? and account_id = ?", m.houseId, m.accountId)) return "already";
      const n = this.sql.get<{ n: number }>("select count(*) as n from members where house_id = ?", m.houseId)!.n;
      if (!h || n >= (h.max_members as number)) return "full";
      this.insertMember(m);
      return "added";
    });
  }

  async memberFor(houseId: string, accountId: string) {
    const r = this.sql.get("select * from members where house_id = ? and account_id = ?", houseId, accountId);
    return r ? member(r) : null;
  }

  async housesFor(accountId: string) {
    const rows = this.sql.all("select h.* from houses h join members m on m.house_id = h.id where m.account_id = ? order by h.created_at desc", accountId);
    return Promise.all(rows.map(async (r) => ({ house: house(r), members: await this.listMembers(r.id as string) })));
  }

  async claimMember(houseId: string, tokenHash: string, accountId: string) {
    return this.sql.tx(() => {
      const r = this.sql.get("select * from members where house_id = ? and token_hash = ?", houseId, tokenHash);
      if (!r) return null;
      // already in this house under another member (claimed from a second browser): keep the one they have
      const mine = this.sql.get("select * from members where house_id = ? and account_id = ?", houseId, accountId);
      if (mine) return member(mine);
      if (r.account_id && r.account_id !== accountId) return null;
      this.sql.run("update members set account_id = ?, token_hash = null where id = ?", accountId, r.id as string);
      return member({ ...r, account_id: accountId });
    });
  }

  async removeMember(houseId: string, accountId: string) {
    return this.sql.tx(() => {
      this.sql.run("delete from members where house_id = ? and account_id = ?", houseId, accountId);
      return this.sql.get<{ n: number }>("select count(*) as n from members where house_id = ?", houseId)!.n;
    });
  }

  async recordVisit(houseId: string, memberId: string, day: Day) {
    return this.sql.tx(() => {
      const m = this.sql.get<{ account_id: string | null }>("select account_id from members where id = ? and house_id = ?", memberId, houseId);
      if (!m?.account_id) return null;
      const before = this.sql.all<{ day: string }>("select day from visits where account_id = ?", m.account_id).map((r) => r.day);
      const reward = visitReward(before, day);
      if (!reward) return null;
      this.sql.run(
        "insert into visits (account_id, day, coins, streak, house_id, at) values (?, ?, ?, ?, ?, ?)",
        m.account_id,
        day,
        reward.coins,
        reward.streak,
        houseId,
        Date.now(),
      );
      return { day, ...reward };
    });
  }

  async visitsFor(accountId: string) {
    return this.sql.all<Visit>("select day, coins, streak from visits where account_id = ? order by day", accountId);
  }
}

export class SqlHouseStore implements HouseStore {
  constructor(private sql: Sql) {}

  async loadSnapshot(houseId: string) {
    const r = this.sql.get("select version, blueprint from snapshots where house_id = ?", houseId);
    return r ? { version: r.version as number, blueprint: JSON.parse(r.blueprint as string) as Blueprint } : null;
  }

  async saveSnapshot(houseId: string, s: Snapshot) {
    this.sql.run(
      "insert into snapshots (house_id, version, blueprint) values (?, ?, ?) on conflict(house_id) do update set version = excluded.version, blueprint = excluded.blueprint",
      houseId,
      s.version,
      JSON.stringify(s.blueprint),
    );
  }

  async appendOp(houseId: string, a: AppliedOp) {
    this.sql.run(
      "insert into ops (house_id, version, member_id, client_op_id, op, at) values (?, ?, ?, ?, ?, ?)",
      houseId,
      a.version,
      a.by,
      a.clientOpId,
      JSON.stringify(a.op),
      Date.now(),
    );
  }

  async opsSince(houseId: string, after: number, limit: number) {
    return this.sql
      .all("select version, member_id, client_op_id, op from ops where house_id = ? and version > ? order by version limit ?", houseId, after, limit)
      .map((r) => ({ version: r.version as number, by: r.member_id as string, clientOpId: r.client_op_id as string, op: JSON.parse(r.op as string) as LoggedOp }));
  }

  async findClientOp(houseId: string, memberId: string, clientOpId: string) {
    const r = this.sql.get("select version from ops where house_id = ? and member_id = ? and client_op_id = ?", houseId, memberId, clientOpId);
    return r ? (r.version as number) : null;
  }

  async pruneOps(houseId: string, upTo: number) {
    this.sql.run("delete from ops where house_id = ? and version <= ?", houseId, upTo);
  }

  async loadLife(houseId: string) {
    const r = this.sql.get("select state from life where house_id = ?", houseId);
    return r ? (JSON.parse(r.state as string) as LifeState) : null;
  }

  async saveLife(houseId: string, life: LifeState) {
    this.sql.run(
      "insert into life (house_id, state, updated_at) values (?, ?, ?) on conflict(house_id) do update set state = excluded.state, updated_at = excluded.updated_at",
      houseId,
      JSON.stringify(life),
      Date.now(),
    );
  }

  async appendChat(houseId: string, m: ChatMessage, keep: number) {
    this.sql.tx(() => {
      this.sql.run("insert into chat (house_id, id, member_id, text, at) values (?, ?, ?, ?, ?)", houseId, m.id, m.by, m.text, m.at);
      this.sql.run(
        "delete from chat where house_id = ? and rowid not in (select rowid from chat where house_id = ? order by at desc, rowid desc limit ?)",
        houseId,
        houseId,
        keep,
      );
    });
  }

  async recentChat(houseId: string, limit: number) {
    return this.sql
      .all("select id, member_id, text, at from chat where house_id = ? order by at desc, rowid desc limit ?", houseId, limit)
      .reverse()
      .map((r) => ({ id: r.id as string, by: r.member_id as string, text: r.text as string, at: r.at as number }));
  }

  async deleteHouse(houseId: string) {
    this.sql.tx(() => {
      for (const t of ["snapshots", "ops", "life", "chat"]) this.sql.run(`delete from ${t} where house_id = ?`, houseId);
    });
  }
}
