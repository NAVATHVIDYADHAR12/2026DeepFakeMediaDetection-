/**
 * The one place that knows whether we are talking to SQLite or Postgres.
 *
 * The Python version had no such split: SQLite ships with Python, so there was
 * a file on disk and nothing to decide. Vercel removes that option - its
 * filesystem is ephemeral and per-invocation, so a SQLite file there would
 * lose every account and every scan between requests.
 *
 * So: Postgres when DATABASE_URL is set (deployed), SQLite otherwise (local).
 * Local development keeps working with no database server to install, which is
 * what made the Python version pleasant to run, and the deployed app gets
 * storage that actually persists.
 *
 * Everything above this file is dialect-agnostic and async. Async is not
 * optional here even though SQLite is synchronous - the Postgres driver is
 * async, and one shared interface has to be the wider of the two.
 */

import * as cfg from './config.js'

export const DATABASE_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? ''
export const DIALECT = DATABASE_URL ? 'postgres' : 'sqlite'

/**
 * Rewrite `?` placeholders to Postgres's `$1, $2, ...`.
 *
 * Queries are written once, in SQLite's style, and translated on the way out.
 * The scan only has to respect string literals: a `?` inside quotes is data,
 * not a placeholder, and renumbering it would corrupt the query.
 */
export function toPgPlaceholders(sql) {
  let out = ''
  let n = 0
  let quote = null
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (quote) {
      out += c
      if (c === quote) quote = null      // '' inside a string just re-opens it
      continue
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue }
    out += c === '?' ? `$${++n}` : c
  }
  return out
}

// --------------------------------------------------------------------- sqlite
let sqliteDb = null
let sqlitePath = null

async function sqliteDriver() {
  const { DatabaseSync } = await import('node:sqlite')

  // Reopen when the path changes. The Python did the same, because the tests
  // point cfg.DB_PATH at a fresh file per test and expect that to take effect.
  if (sqliteDb && sqlitePath === cfg.DB_PATH) return sqliteDb
  if (sqliteDb) { try { sqliteDb.close() } catch { /* already gone */ } }

  cfg.ensureDirs()
  const db = new DatabaseSync(cfg.DB_PATH)
  // Applied once per connection rather than once per query, as in the Python.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')

  sqliteDb = db
  sqlitePath = cfg.DB_PATH
  return db
}

// ------------------------------------------------------------------- postgres
let pgSql = null

async function pgDriver() {
  if (pgSql) return pgSql
  const postgres = (await import('postgres')).default
  pgSql = postgres(DATABASE_URL, {
    // Serverless: many short-lived instances, each wanting few connections.
    // A large pool per instance exhausts the server's limit instead of
    // helping.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    // Managed Postgres (Neon, Supabase, Vercel) terminates non-TLS
    // connections; 'require' works with their certificates.
    ssl: 'require',
  })
  return pgSql
}

/**
 * Run a query and return rows as plain objects.
 *
 * Parameters use `?` regardless of backend. Postgres BYTEA arrives as a
 * Buffer and SQLite BLOB as a Uint8Array; callers that read embeddings
 * normalise both, so nothing here special-cases them.
 */
export async function query(sql, params = []) {
  if (DIALECT === 'postgres') {
    const s = await pgDriver()
    const rows = await s.unsafe(toPgPlaceholders(sql), params)
    return Array.from(rows)
  }
  const db = await sqliteDriver()
  const stmt = db.prepare(sql)
  return stmt.all(...params)
}

/** Run a statement that returns no rows. Reports rows affected where known. */
export async function run(sql, params = []) {
  if (DIALECT === 'postgres') {
    const s = await pgDriver()
    const res = await s.unsafe(toPgPlaceholders(sql), params)
    return { changes: res.count ?? 0 }
  }
  const db = await sqliteDriver()
  const res = db.prepare(sql).run(...params)
  return { changes: Number(res.changes ?? 0) }
}

/**
 * Insert one row and return its generated id.
 *
 * The two backends disagree completely here. SQLite reports the rowid after
 * the fact; Postgres has no such concept and must be asked for the column up
 * front with RETURNING. Callers pass the plain INSERT and name the id column.
 */
export async function insertReturningId(sql, params = [], idColumn = 'id') {
  if (DIALECT === 'postgres') {
    const s = await pgDriver()
    const rows = await s.unsafe(`${toPgPlaceholders(sql)} RETURNING ${idColumn}`, params)
    return Number(rows[0][idColumn])
  }
  const db = await sqliteDriver()
  const res = db.prepare(sql).run(...params)
  return Number(res.lastInsertRowid)
}

/** Execute a multi-statement script (schema creation). */
export async function exec(sqlScript) {
  if (DIALECT === 'postgres') {
    const s = await pgDriver()
    await s.unsafe(sqlScript)
    return
  }
  const db = await sqliteDriver()
  db.exec(sqlScript)
}

/** Close the connection. Used at shutdown and between tests. */
export async function close() {
  if (sqliteDb) { try { sqliteDb.close() } catch { /* already gone */ } sqliteDb = null; sqlitePath = null }
  if (pgSql) { await pgSql.end({ timeout: 5 }); pgSql = null }
}
