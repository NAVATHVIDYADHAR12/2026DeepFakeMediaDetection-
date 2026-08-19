/**
 * Persistence for scan history and the enrolled-identity gallery.
 *
 * A port of backend/database.py, with one structural change: the Python could
 * assume SQLite because SQLite ships with Python. Deployed on Vercel there is
 * no durable filesystem, so the backend is chosen at runtime - see
 * db-driver.js. The queries below are written once and translated there.
 *
 * The connection-lifetime care the Python module documented is not repeated
 * here because it does not apply the same way: node:sqlite hands back one
 * handle that stays open for the process, and the Postgres driver owns its own
 * pool. Neither reopens per query, which was the expensive mistake.
 */

import * as cfg from './config.js'
import { query, run, exec, close as driverClose, DIALECT } from './db-driver.js'
import { pyRound } from './num.js'

export { driverClose as close, DIALECT }

// Types are the only real schema divergence: SQLite is loose about them,
// Postgres is not. BLOB/BYTEA and REAL/DOUBLE PRECISION have to be spelled
// per dialect or one of the two rejects the table outright.
const SCHEMA = (d) => {
  const REAL = d === 'postgres' ? 'DOUBLE PRECISION' : 'REAL'
  const BLOB = d === 'postgres' ? 'BYTEA' : 'BLOB'
  return `
CREATE TABLE IF NOT EXISTS scans (
    scan_id        TEXT PRIMARY KEY,
    created_at     TEXT NOT NULL,
    filename       TEXT NOT NULL,
    media_type     TEXT NOT NULL,
    verdict        TEXT NOT NULL,
    risk_level     TEXT,
    fake_probability  ${REAL} NOT NULL,
    authenticity_score ${REAL} NOT NULL,
    confidence     ${REAL},
    faces_detected INTEGER DEFAULT 0,
    file_size_bytes INTEGER,
    processing_ms  ${REAL},
    report_json    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_verdict ON scans(verdict);

CREATE TABLE IF NOT EXISTS identities (
    name        TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    embedding   ${BLOB} NOT NULL,
    sample_count INTEGER DEFAULT 1,
    notes       TEXT
);
`
}

/**
 * Move an unreadable database aside so the app can start with a fresh one.
 *
 * Refusing to start at all would take the whole tool down over a cache of past
 * scans. The old file is renamed rather than deleted, so nothing is silently
 * destroyed and it can still be examined.
 *
 * SQLite only. A managed Postgres does not hand back a corrupt file for us to
 * rename, and recovering one is its operator's job, not the app's.
 */
async function quarantineUnreadable() {
  if (DIALECT !== 'sqlite') return null

  const fs = await import('node:fs')
  const path = await import('node:path')
  if (!fs.existsSync(cfg.DB_PATH)) return null

  const { DatabaseSync } = await import('node:sqlite')
  let probe = null
  try {
    probe = new DatabaseSync(cfg.DB_PATH)
    probe.prepare('SELECT count(*) FROM sqlite_master').get()
    return null
  } catch {
    // Falls through to the rename below.
  } finally {
    // Closed in `finally`, not after the query: if the probe throws, an open
    // handle keeps the file locked, and on Windows the rename then fails.
    if (probe) { try { probe.close() } catch { /* already gone */ } }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  const dir = path.dirname(cfg.DB_PATH)
  const stem = path.basename(cfg.DB_PATH, path.extname(cfg.DB_PATH))
  const broken = path.join(dir, `${stem}.corrupt-${stamp}.db`)
  try {
    fs.renameSync(cfg.DB_PATH, broken)
  } catch (exc) {
    // Another process still holds it. Starting with a broken database is worse
    // than saying so, so this is raised rather than swallowed.
    throw new Error(
      `The database at ${cfg.DB_PATH} is unreadable and could not be moved `
      + `aside (${exc.message}). Close any other running copy of the server `
      + 'and start again.',
    )
  }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(cfg.DB_PATH + suffix) } catch { /* may not exist */ }
  }
  return path.basename(broken)
}

/** Create the schema. Returns the quarantined filename if one was moved. */
export async function init() {
  // Release any handle on the old file before the probe tries to rename it.
  await driverClose()
  const moved = await quarantineUnreadable()
  await exec(SCHEMA(DIALECT))
  return moved
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')

/**
 * Upsert on a single-column primary key.
 *
 * SQLite's INSERT OR REPLACE has no Postgres equivalent that behaves the same
 * way, so this writes the standard ON CONFLICT form for both. SQLite has
 * supported it since 3.24 and node:sqlite is well past that.
 */
function upsert(table, cols, pk) {
  const placeholders = cols.map(() => '?').join(',')
  const updates = cols.filter((c) => c !== pk).map((c) => `${c} = EXCLUDED.${c}`).join(', ')
  return `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
          ON CONFLICT (${pk}) DO UPDATE SET ${updates}`
}

// ------------------------------------------------------------------------ scans
/**
 * Persist a report. The face embeddings are stripped - they are large and only
 * meaningful during the request that produced them.
 */
export async function saveScan(report) {
  const slim = JSON.parse(JSON.stringify(report))
  for (const face of slim.faces ?? []) delete face._embedding

  const cols = ['scan_id', 'created_at', 'filename', 'media_type', 'verdict',
    'risk_level', 'fake_probability', 'authenticity_score', 'confidence',
    'faces_detected', 'file_size_bytes', 'processing_ms', 'report_json']

  await run(upsert('scans', cols, 'scan_id'), [
    report.scan_id, now(), report.filename, report.media_type,
    report.verdict, report.risk_level ?? null,
    report.fake_probability, report.authenticity_score,
    report.confidence ?? null,
    report.faces_detected ?? report.people_detected ?? 0,
    report.file_size_bytes ?? null, report.processing_ms ?? null,
    JSON.stringify(slim),
  ])
}

export async function recentScans(limit = 20, offset = 0, verdict = null) {
  let sql = 'SELECT scan_id, created_at, filename, media_type, verdict, risk_level,'
          + ' fake_probability, authenticity_score, confidence, faces_detected,'
          + ' file_size_bytes, processing_ms FROM scans'
  const params = []
  if (verdict) { sql += ' WHERE verdict = ?'; params.push(verdict.toUpperCase()) }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)
  return query(sql, params)
}

export async function getScan(scanId) {
  const rows = await query('SELECT report_json FROM scans WHERE scan_id = ?', [scanId])
  return rows.length ? JSON.parse(rows[0].report_json) : null
}

export async function deleteScan(scanId) {
  const { changes } = await run('DELETE FROM scans WHERE scan_id = ?', [scanId])
  return changes > 0
}

/** Aggregates that drive the dashboard tiles and the donut chart. */
export async function stats() {
  // COUNT and SUM come back as BigInt from Postgres and as number from
  // SQLite; Number() over both keeps the JSON identical to the Python's.
  const num = (v) => (v === null || v === undefined ? 0 : Number(v))

  const [{ c: totalRaw }] = await query('SELECT COUNT(*) c FROM scans')
  const total = num(totalRaw)

  const byVerdict = {}
  for (const r of await query('SELECT verdict, COUNT(*) c FROM scans GROUP BY verdict')) {
    byVerdict[r.verdict] = num(r.c)
  }
  const byType = {}
  for (const r of await query('SELECT media_type, COUNT(*) c FROM scans GROUP BY media_type')) {
    byType[r.media_type] = num(r.c)
  }

  const [{ a: avgRaw }] = await query('SELECT AVG(processing_ms) a FROM scans')
  const avgMs = num(avgRaw)

  const trend = (await query(
    `SELECT substr(created_at, 1, 10) day,
            COUNT(*) total,
            SUM(CASE WHEN verdict='FAKE' THEN 1 ELSE 0 END) fake
     FROM scans GROUP BY substr(created_at, 1, 10) ORDER BY day DESC LIMIT 14`,
  )).map((r) => ({ day: r.day, total: num(r.total), fake: num(r.fake) }))

  const authentic = byVerdict.AUTHENTIC ?? 0
  const suspicious = byVerdict.SUSPICIOUS ?? 0
  const fake = byVerdict.FAKE ?? 0
  const pct = (n) => (total ? pyRound((n / total) * 100, 1) : 0.0)

  return {
    total_scans: total,
    authentic,
    suspicious,
    fake,
    authentic_pct: pct(authentic),
    suspicious_pct: pct(suspicious),
    fake_pct: pct(fake),
    by_media_type: byType,
    avg_processing_ms: pyRound(avgMs, 1),
    trend: trend.reverse(),
  }
}

// ------------------------------------------------------------------- identities
/**
 * Embeddings cross the driver boundary as raw bytes.
 *
 * Postgres BYTEA arrives as a Buffer and SQLite BLOB as a Uint8Array, and
 * neither is guaranteed to start on a 4-byte boundary within its backing
 * ArrayBuffer. A Float32Array view over an unaligned offset throws, so this
 * copies rather than views. 512 bytes per identity - the copy is not worth
 * optimising away.
 */
function bytesToFloat32(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const copy = new Uint8Array(u8.byteLength)
  copy.set(u8)
  return new Float32Array(copy.buffer)
}

const float32ToBytes = (vec) => Buffer.from(new Float32Array(vec).buffer)

/**
 * Add or update a known face. Re-enrolling averages the embeddings, which
 * makes the identity more robust across pose and lighting.
 */
export async function enrollIdentity(name, embedding, notes = null) {
  let vec = new Float32Array(embedding)

  const rows = await query(
    'SELECT embedding, sample_count FROM identities WHERE name = ?', [name],
  )

  let count = 1
  if (rows.length) {
    const existing = bytesToFloat32(rows[0].embedding)
    const n = Number(rows[0].sample_count)
    const merged = new Float32Array(vec.length)
    for (let i = 0; i < vec.length; i++) merged[i] = (existing[i] * n + vec[i]) / (n + 1)
    vec = merged
    count = n + 1
  }

  await run(
    upsert('identities', ['name', 'created_at', 'embedding', 'sample_count', 'notes'], 'name'),
    [name, now(), float32ToBytes(vec), count, notes],
  )

  return { name, sample_count: count, dimensions: vec.length }
}

export async function loadGallery() {
  const rows = await query('SELECT name, embedding FROM identities')
  const out = {}
  for (const r of rows) out[r.name] = bytesToFloat32(r.embedding)
  return out
}

export async function listIdentities() {
  const rows = await query(
    'SELECT name, created_at, sample_count, notes FROM identities ORDER BY name',
  )
  return rows.map((r) => ({ ...r, sample_count: Number(r.sample_count) }))
}

export async function deleteIdentity(name) {
  const { changes } = await run('DELETE FROM identities WHERE name = ?', [name])
  return changes > 0
}
