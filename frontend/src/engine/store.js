/**
 * Scan history for the standalone (no-backend) mode.
 *
 * IndexedDB rather than localStorage: reports embed base64 previews and run to
 * hundreds of kilobytes each, well past localStorage's ~5 MB ceiling.
 *
 * This is the browser's own storage — it never leaves the machine, and it is
 * per-browser rather than per-account.
 */

const DB_NAME = 'omniguard'
const DB_VERSION = 1
const STORE = 'scans'

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'scan_id' })
        store.createIndex('created_at', 'created_at')
        store.createIndex('verdict', 'verdict')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  return dbPromise
}

async function tx(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const store = transaction.objectStore(STORE)
    let result
    try {
      result = fn(store)
    } catch (err) {
      reject(err)
      return
    }
    transaction.oncomplete = () => resolve(result?.result ?? result)
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function saveScan(report) {
  await tx('readwrite', (store) => store.put(report))
  return report
}

export async function getScan(scanId) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(scanId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteScan(scanId) {
  await tx('readwrite', (store) => store.delete(scanId))
  return true
}

export async function allScans() {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => {
      // Newest first, matching the server's ordering.
      const rows = (req.result ?? []).sort(
        (a, b) => String(b.created_at).localeCompare(String(a.created_at))
      )
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

/** Summary list — the same shape the /api/scans endpoint returns. */
export async function recentScans({ limit = 20, offset = 0, verdict } = {}) {
  let rows = await allScans()
  if (verdict) rows = rows.filter((r) => r.verdict === verdict.toUpperCase())

  return rows.slice(offset, offset + limit).map((r) => ({
    scan_id: r.scan_id,
    created_at: r.created_at,
    filename: r.filename,
    media_type: r.media_type,
    verdict: r.verdict,
    risk_level: r.risk_level,
    fake_probability: r.fake_probability,
    authenticity_score: r.authenticity_score,
    confidence: r.confidence,
    faces_detected: r.faces_detected ?? 0,
    file_size_bytes: r.file_size_bytes,
    processing_ms: r.processing_ms,
  }))
}

/** Dashboard aggregates — the same shape /api/stats returns. */
export async function stats() {
  const rows = await allScans()
  const total = rows.length

  const count = (v) => rows.filter((r) => r.verdict === v).length
  const authentic = count('AUTHENTIC')
  const suspicious = count('SUSPICIOUS')
  const fake = count('FAKE')
  const unverified = count('UNVERIFIED')

  const pct = (n) => (total ? Number(((n / total) * 100).toFixed(1)) : 0)

  const byType = {}
  rows.forEach((r) => { byType[r.media_type] = (byType[r.media_type] ?? 0) + 1 })

  const avg = total
    ? rows.reduce((s, r) => s + (r.processing_ms ?? 0), 0) / total
    : 0

  // Last 14 days, oldest first, matching the server.
  const byDay = new Map()
  rows.forEach((r) => {
    const day = String(r.created_at).slice(0, 10)
    const entry = byDay.get(day) ?? { day, total: 0, fake: 0 }
    entry.total += 1
    if (r.verdict === 'FAKE') entry.fake += 1
    byDay.set(day, entry)
  })
  const trend = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14)

  return {
    total_scans: total,
    authentic,
    suspicious,
    fake,
    unverified,
    authentic_pct: pct(authentic),
    suspicious_pct: pct(suspicious),
    fake_pct: pct(fake),
    by_media_type: byType,
    avg_processing_ms: Number(avg.toFixed(1)),
    trend,
  }
}

export async function clearAll() {
  await tx('readwrite', (store) => store.clear())
}
