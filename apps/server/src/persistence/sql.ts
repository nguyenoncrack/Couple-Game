/**
 * The little bit of SQLite the stores need, so they run on Node's `node:sqlite` and on a Durable Object's built-in
 * SQLite alike. Both are synchronous, which keeps a check-then-write (is the house full?) in one step.
 */

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Sql {
  run(query: string, ...args: SqlValue[]): void;
  all<T = Row>(query: string, ...args: SqlValue[]): T[];
  get<T = Row>(query: string, ...args: SqlValue[]): T | undefined;
  /** Run `fn` as one transaction: all of it is written or none. */
  tx<T>(fn: () => T): T;
}

/** The directory's tables. Names are unique by `name_key` (lower case, single spaces). */
export const DIRECTORY_SCHEMA = [
  `create table if not exists accounts (
    id text primary key,
    name text not null,
    name_key text not null unique,
    password text not null,
    created_at integer not null
  )`,
  `create table if not exists sessions (
    token_hash text primary key,
    account_id text not null references accounts(id) on delete cascade,
    created_at integer not null
  )`,
  `create index if not exists sessions_account on sessions(account_id)`,
  `create table if not exists houses (
    id text primary key,
    name text not null,
    invite_code text not null unique,
    max_members integer not null,
    created_at integer not null
  )`,
  `create table if not exists members (
    id text primary key,
    house_id text not null references houses(id) on delete cascade,
    account_id text references accounts(id) on delete set null,
    name text not null,
    color text not null,
    role text not null,
    token_hash text unique,
    joined_at integer not null
  )`,
  `create index if not exists members_house on members(house_id)`,
  `create unique index if not exists members_account on members(house_id, account_id)`,
];

/** A house's own tables. On Cloudflare each house has its own database, but `house_id` keeps one file shareable. */
export const HOUSE_SCHEMA = [
  `create table if not exists snapshots (
    house_id text primary key,
    version integer not null,
    blueprint text not null
  )`,
  `create table if not exists ops (
    house_id text not null,
    version integer not null,
    member_id text not null,
    client_op_id text not null,
    op text not null,
    at integer not null,
    primary key (house_id, version)
  )`,
  `create unique index if not exists ops_client on ops(house_id, member_id, client_op_id)`,
  `create table if not exists life (
    house_id text primary key,
    state text not null,
    updated_at integer not null
  )`,
  `create table if not exists chat (
    house_id text not null,
    id text not null,
    member_id text not null,
    text text not null,
    at integer not null,
    primary key (house_id, id)
  )`,
  `create index if not exists chat_at on chat(house_id, at)`,
];

export function createTables(sql: Sql, schema: string[]) {
  for (const statement of schema) sql.run(statement);
}
