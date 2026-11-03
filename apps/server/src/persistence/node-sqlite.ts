import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createTables, DIRECTORY_SCHEMA, HOUSE_SCHEMA, type Row, type Sql, type SqlValue } from "./sql";
import { SqlDirectory, SqlHouseStore } from "./sql-stores";

/** Local play and tests: the directory and every house in one SQLite file (or in memory). */
export function openSqlite(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;");
  const args = (a: SqlValue[]) => a as SQLInputValue[];
  const sql: Sql = {
    run: (q, ...a) => void db.prepare(q).run(...args(a)),
    all: <T = Row>(q: string, ...a: SqlValue[]) => db.prepare(q).all(...args(a)) as T[],
    get: <T = Row>(q: string, ...a: SqlValue[]) => db.prepare(q).get(...args(a)) as T | undefined,
    tx(fn) {
      db.exec("begin immediate");
      try {
        const out = fn();
        db.exec("commit");
        return out;
      } catch (e) {
        db.exec("rollback");
        throw e;
      }
    },
  };
  upgradeFromBeforeAccounts(db, sql);
  createTables(sql, DIRECTORY_SCHEMA);
  createTables(sql, HOUSE_SCHEMA);
  return { sql, directory: new SqlDirectory(sql), houses: new SqlHouseStore(sql), close: () => db.close() };
}

/**
 * Before accounts, a house row carried its own snapshot and every member had a device token. Move snapshots to their
 * own table and let members belong to an account instead (the old tokens still work once, to claim them).
 */
function upgradeFromBeforeAccounts(db: DatabaseSync, sql: Sql) {
  const cols = sql.all<{ name: string }>("select name from pragma_table_info('houses')").map((c) => c.name);
  if (!cols.includes("snapshot")) return;
  db.exec("pragma foreign_keys = off");
  sql.tx(() => {
    sql.run(HOUSE_SCHEMA[0]!);
    sql.run("insert into snapshots (house_id, version, blueprint) select id, snapshot_version, snapshot from houses");
    sql.run("alter table houses drop column snapshot");
    sql.run("alter table houses drop column snapshot_version");
    for (const s of DIRECTORY_SCHEMA.slice(0, 3)) sql.run(s);
    sql.run("alter table members rename to members_old");
    sql.run(DIRECTORY_SCHEMA.find((s) => s.includes("table if not exists members"))!);
    sql.run(
      "insert into members (id, house_id, account_id, name, color, role, token_hash, joined_at) select id, house_id, null, name, color, role, token_hash, joined_at from members_old",
    );
    sql.run("drop table members_old");
  });
  db.exec("pragma foreign_keys = on");
}
