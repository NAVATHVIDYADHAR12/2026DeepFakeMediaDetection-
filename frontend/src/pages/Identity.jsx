import { useEffect, useRef, useState } from 'react'

import { api, verdictMeta } from '../api.js'
import { Meter } from '../components/charts.jsx'
import { EmptyState, Panel, Spinner, VerdictBadge } from '../components/ui.jsx'

/**
 * Face recognition: enrol known people, then identify faces in a new image and
 * report each one's deepfake verdict alongside the identity. The pairing is the
 * point - "this claims to be X, and the face is manipulated" is the useful
 * statement, not either half on its own.
 */
export default function Identity() {
  const [identities, setIdentities] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [matches, setMatches] = useState(null)

  const enrollRef = useRef(null)
  const matchRef = useRef(null)

  const load = () => api.identities().then((r) => setIdentities(r.identities)).catch((e) => setError(e.message))
  useEffect(load, [])

  const enroll = async (file) => {
    if (!name.trim()) { setError('Enter a name before choosing a photo.'); return }
    setBusy(true); setError(null)
    try {
      await api.enroll(name.trim(), file)
      setName('')
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const identify = async (file) => {
    setBusy(true); setError(null); setMatches(null)
    try {
      setMatches(await api.matchIdentity(file))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const remove = async (n) => { await api.deleteIdentity(n); load() }

  return (
    <div className="space-y-5">
      {error && (
        <div className="px-4 py-3 rounded-lg text-[13px]"
             style={{
               background: 'color-mix(in srgb, var(--critical) 12%, transparent)',
               border: '1px solid color-mix(in srgb, var(--critical) 34%, transparent)',
             }}>
          <strong style={{ color: 'var(--critical)' }}>✕ </strong>{error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Enrol a Person">
          <p className="text-[13px] -mt-1 mb-4 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Stores a 128-dimension face embedding, not the photo itself. Enrolling the same
            person again averages the vectors, which makes matching more robust across pose
            and lighting.
          </p>
          <div className="flex gap-2 flex-wrap">
            <input value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="Person's name" aria-label="Person's name"
                   className="flex-1 min-w-[160px] px-3 py-2 rounded-lg text-sm outline-none"
                   style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <button onClick={() => enrollRef.current?.click()} disabled={busy || !name.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-45"
                    style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-2))', color: 'var(--on-accent)' }}>
              Choose photo
            </button>
            <input ref={enrollRef} type="file" accept="image/*" className="hidden"
                   onChange={(e) => e.target.files?.[0] && enroll(e.target.files[0])} />
          </div>
        </Panel>

        <Panel title="Identify Faces">
          <p className="text-[13px] -mt-1 mb-4 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Matches every face in an image against the enrolled gallery and reports its
            deepfake verdict at the same time.
          </p>
          <button onClick={() => matchRef.current?.click()} disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-45"
                  style={{ background: 'var(--surface-3)', border: '1px solid var(--border-bright)' }}>
            Upload image to identify
          </button>
          <input ref={matchRef} type="file" accept="image/*" className="hidden"
                 onChange={(e) => e.target.files?.[0] && identify(e.target.files[0])} />
        </Panel>
      </div>

      {busy && <Spinner label="Working…" />}

      {matches && (
        <Panel title="Identification Result">
          <p className="text-[13px] mb-4 -mt-1" style={{ color: 'var(--ink-muted)' }}>
            {matches.faces_detected} face(s) detected · gallery holds {matches.gallery_size} identity(ies)
          </p>
          {!matches.matches.length ? (
            <EmptyState icon="☺" title="No faces found in that image" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                    <th className="py-2 pr-4 font-medium">Face</th>
                    <th className="py-2 pr-4 font-medium">Identity</th>
                    <th className="py-2 pr-4 font-medium w-[170px]">Similarity</th>
                    <th className="py-2 font-medium">Deepfake verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.matches.map((m) => (
                    <tr key={m.face_id} className="border-t row-hover" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-3 pr-4">Face {m.face_id}</td>
                      <td className="py-3 pr-4 font-medium"
                          style={{ color: m.matched ? 'var(--ink)' : 'var(--ink-muted)' }}>
                        {m.matched ? m.identity : 'Unknown'}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2.5">
                          <span className="flex-1">
                            <Meter value={Math.max(0, m.similarity)}
                                   color={m.matched ? 'var(--good)' : 'var(--ink-muted)'} />
                          </span>
                          <span className="tnum text-xs w-11 text-right">{m.similarity.toFixed(3)}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        {m.verdict ? (
                          <div className="flex items-center gap-2.5">
                            <VerdictBadge verdict={m.verdict} />
                            <span className="tnum text-xs" style={{ color: verdictMeta(m.verdict).color }}>
                              {(m.fake_probability * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : <span style={{ color: 'var(--ink-muted)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Enrolled Identities">
        {!identities ? <Spinner />
          : !identities.length ? (
            <EmptyState icon="☺" title="Gallery is empty"
                        body="Enrol someone above to start matching faces against known people." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {identities.map((i) => (
                <li key={i.name} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: 'var(--surface-3)' }} aria-hidden="true">☺</span>
                  <span className="flex-1 font-medium">{i.name}</span>
                  <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {i.sample_count} sample{i.sample_count === 1 ? '' : 's'}
                  </span>
                  <button onClick={() => remove(i.name)} aria-label={`Remove ${i.name}`}
                          className="text-xs px-2 py-1 rounded" style={{ color: 'var(--ink-muted)' }}>✕</button>
                </li>
              ))}
            </ul>
          )}
      </Panel>
    </div>
  )
}
