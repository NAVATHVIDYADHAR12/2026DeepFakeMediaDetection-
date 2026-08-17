import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, formatBytes, timeAgo } from '../api.js'
import { EmptyState, Panel, Spinner, VerdictBadge } from '../components/ui.jsx'

const FILTERS = [
  { key: null, label: 'All' },
  { key: 'AUTHENTIC', label: 'Authentic' },
  { key: 'SUSPICIOUS', label: 'Suspicious' },
  { key: 'FAKE', label: 'Fake' },
]

export default function History() {
  const [scans, setScans] = useState(null)
  const [filter, setFilter] = useState(null)
  const [error, setError] = useState(null)

  const load = () => {
    setScans(null)
    api.scans({ limit: 100, verdict: filter })
      .then((r) => setScans(r.scans))
      .catch((e) => setError(e.message))
  }

  useEffect(load, [filter])

  const remove = async (id) => {
    await api.deleteScan(id)
    setScans((prev) => prev.filter((s) => s.scan_id !== id))
  }

  if (error) return <EmptyState icon="⚠" title="Could not load history" body={error} />

  return (
    <div className="space-y-5">
      {/* Filters sit in one row above the table, per the interaction rules */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.label} onClick={() => setFilter(f.key)}
                  className="px-3.5 py-1.5 rounded-lg text-[13px] transition-colors press"
                  style={{
                    background: filter === f.key ? 'var(--brand-2)' : 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    color: filter === f.key ? 'var(--ink)' : 'var(--ink-2)',
                  }}>
            {f.label}
          </button>
        ))}
      </div>

      <Panel title="Scan History">
        {!scans ? <Spinner />
          : !scans.length ? (
            <EmptyState icon="≡" title="No scans found"
                        body={filter ? `No scans with verdict "${filter}".` : 'Analyse a file to populate the history.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                    <th className="py-2 pr-4 font-medium">File</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Verdict</th>
                    <th className="py-2 pr-4 font-medium">Authenticity</th>
                    <th className="py-2 pr-4 font-medium">Faces</th>
                    <th className="py-2 pr-4 font-medium">Size</th>
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.scan_id} className="border-t row-hover" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-2.5 pr-4 max-w-[260px]">
                        <Link to={`/report/${s.scan_id}`} className="truncate block hover:underline">
                          {s.filename}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4" style={{ color: 'var(--ink-muted)' }}>{s.media_type}</td>
                      <td className="py-2.5 pr-4"><VerdictBadge verdict={s.verdict} /></td>
                      <td className="py-2.5 pr-4 tnum">{s.authenticity_score}%</td>
                      <td className="py-2.5 pr-4 tnum">{s.faces_detected}</td>
                      <td className="py-2.5 pr-4 tnum" style={{ color: 'var(--ink-muted)' }}>
                        {formatBytes(s.file_size_bytes)}
                      </td>
                      <td className="py-2.5 pr-4" style={{ color: 'var(--ink-muted)' }}>{timeAgo(s.created_at)}</td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => remove(s.scan_id)}
                                aria-label={`Delete scan of ${s.filename}`}
                                className="text-xs px-2 py-1 rounded hover:opacity-80"
                                style={{ color: 'var(--ink-muted)' }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
    </div>
  )
}
