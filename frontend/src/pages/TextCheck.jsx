import { useState } from 'react'

import { apiUrl } from '../api.js'
import { Meter } from '../components/charts.jsx'
import { Panel } from '../components/ui.jsx'

/**
 * Plagiarism and AI-generated-text analysis.
 *
 * The two results are presented differently on purpose. Plagiarism overlap is
 * an exact measurement against a supplied reference, so it gets a plain
 * percentage. The AI figure is a summary of stylistic statistics that no
 * detector can turn into proof, so it is shown with its component signals and
 * an explicit caveat rather than as a verdict.
 */

const VERDICT_COLOUR = {
  HIGH: 'var(--critical)',
  MODERATE: 'var(--warning)',
  LOW: 'var(--brand)',
  MINIMAL: 'var(--good)',
  'STRONG INDICATORS': 'var(--critical)',
  'SOME INDICATORS': 'var(--warning)',
  'FEW INDICATORS': 'var(--brand)',
  'MINIMAL INDICATORS': 'var(--good)',
}

const colourFor = (v) => VERDICT_COLOUR[v] ?? 'var(--ink-muted)'

/**
 * Rebuild the submitted text with matching runs marked.
 *
 * The backend returns character offsets into the original string, so the text
 * is shown exactly as typed — punctuation, capitalisation and line breaks
 * intact — rather than a reconstructed lowercase copy.
 */
function highlight(text, spans) {
  if (!spans?.length) return text

  const parts = []
  let cursor = 0

  spans.forEach((span, i) => {
    if (span.start > cursor) {
      parts.push(<span key={`plain-${i}`}>{text.slice(cursor, span.start)}</span>)
    }
    parts.push(
      <mark
        key={`hit-${i}`}
        title={`${span.words} consecutive words found in the reference`}
        style={{
          background: 'color-mix(in srgb, var(--warning) 26%, transparent)',
          color: 'var(--ink)',
          borderBottom: '2px solid var(--warning)',
          borderRadius: 3,
          padding: '1px 2px',
        }}
      >
        {text.slice(span.start, span.end)}
      </mark>
    )
    cursor = span.end
  })

  if (cursor < text.length) {
    parts.push(<span key="plain-end">{text.slice(cursor)}</span>)
  }
  return parts
}

function Toggle({ checked, onChange, title, body, accent }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="text-left p-4 rounded-xl press transition-all w-full"
      style={{
        background: checked ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'var(--surface-2)',
        border: `1px solid ${checked ? `color-mix(in srgb, ${accent} 45%, transparent)` : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{
                background: checked ? accent : 'transparent',
                border: `1px solid ${checked ? accent : 'var(--border-bright)'}`,
                color: 'var(--on-accent)',
              }}
              aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
        <span className="font-semibold text-[13px]" style={{ color: checked ? 'var(--ink)' : 'var(--ink-2)' }}>
          {title}
        </span>
      </div>
      <p className="text-[11.5px] leading-relaxed ml-[26px]" style={{ color: 'var(--ink-muted)' }}>
        {body}
      </p>
    </button>
  )
}

function ScoreBlock({ label, percent, verdict, caption }) {
  const colour = colourFor(verdict)
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <div className="text-xs mb-1.5" style={{ color: 'var(--ink-muted)' }}>{label}</div>
        <div className="text-5xl leading-none figure" style={{ color: colour }}>{percent}%</div>
      </div>
      <div className="pb-1">
        <div className="text-sm font-semibold" style={{ color: colour }}>{verdict}</div>
        <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>{caption}</div>
      </div>
    </div>
  )
}

export default function TextCheck() {
  const [text, setText] = useState('')
  const [reference, setReference] = useState('')
  const [wantPlagiarism, setWantPlagiarism] = useState(true)
  const [wantAi, setWantAi] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const canRun = words > 0 && (wantPlagiarism || wantAi) && !busy

  const run = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const body = new FormData()
      body.append('text', text)
      body.append('reference', reference)
      body.append('check_plagiarism', wantPlagiarism)
      body.append('check_ai', wantAi)

      const res = await fetch(apiUrl('/api/text/analyze'), { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail
          : 'Text analysis needs the local service — it is not part of the browser-only build.')
      }
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const plag = result?.plagiarism
  const ai = result?.ai_text

  return (
    <div className="space-y-5 max-w-4xl">
      <Panel index={0} title="Plagiarism & AI Text Detection">
        <p className="text-[13px] -mt-1 mb-5 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Paste text to check. Plagiarism is measured exactly against a reference you supply;
          AI detection reports stylistic indicators, which are suggestive rather than conclusive.
        </p>

        {/* The two filters */}
        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          <Toggle
            checked={wantPlagiarism}
            onChange={setWantPlagiarism}
            accent="var(--warning)"
            title="Plagiarism"
            body="Exact 5-word-sequence overlap against a reference text. Needs something to compare with — it does not search the web."
          />
          <Toggle
            checked={wantAi}
            onChange={setWantAi}
            accent="var(--brand)"
            title="AI-generated content"
            body="Sentence-length variation, vocabulary diversity, repetition and model-typical phrasing. Indicators, not proof."
          />
        </div>

        <label className="block mb-4">
          <span className="text-[12px] mb-1.5 flex items-center justify-between" style={{ color: 'var(--ink-2)' }}>
            <span>Text to check</span>
            <span className="tnum" style={{ color: words < 40 && words > 0 ? 'var(--warning)' : 'var(--ink-muted)' }}>
              {words} words{words > 0 && words < 40 ? ' — 40+ needed for AI indicators' : ''}
            </span>
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder="Paste the text you want to analyse…"
            className="w-full px-4 py-3 rounded-xl text-[13px] outline-none resize-y leading-relaxed"
            style={{
              background: 'rgba(3,7,18,.5)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
            }}
          />
        </label>

        {wantPlagiarism && (
          <label className="block mb-5">
            <span className="text-[12px] mb-1.5 block" style={{ color: 'var(--ink-2)' }}>
              Reference text to compare against
            </span>
            <textarea
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              rows={5}
              placeholder="Paste the suspected source — an article, a classmate's essay, documentation…"
              className="w-full px-4 py-3 rounded-xl text-[13px] outline-none resize-y leading-relaxed"
              style={{
                background: 'rgba(3,7,18,.5)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
              }}
            />
          </label>
        )}

        <button
          onClick={run}
          disabled={!canRun}
          className="px-7 py-2.5 rounded-full text-sm font-semibold press disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
            color: 'var(--on-accent)',
            boxShadow: canRun ? '0 0 28px -10px rgba(0,240,255,.8)' : 'none',
            cursor: canRun ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Analysing…' : 'Find plagiarism & AI content'}
        </button>

        {error && (
          <div className="mt-4 px-4 py-3 rounded-lg text-[13px]"
               style={{
                 background: 'color-mix(in srgb, var(--critical) 12%, transparent)',
                 border: '1px solid color-mix(in srgb, var(--critical) 34%, transparent)',
                 color: 'var(--ink-2)',
               }}>
            <strong style={{ color: 'var(--critical)' }}>✕ </strong>{error}
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------------ plagiarism --- */}
      {plag && (
        <Panel index={1} title="Plagiarism">
          {!plag.available ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>{plag.reason}</p>
          ) : (
            <>
              <ScoreBlock
                label="Overlap with reference"
                percent={plag.overlap_percent}
                verdict={plag.verdict}
                caption={`${plag.matched_ngrams} of ${plag.total_ngrams} ${plag.ngram_size}-word sequences matched`}
              />

              <div className="mt-4">
                <Meter value={plag.overlap_percent / 100} color={colourFor(plag.verdict)} />
              </div>

              {plag.matched_spans?.length > 0 && (
                <div className="mt-5">
                  <div className="text-[12px] mb-2 flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
                    <span>Where it matches — highlighted in your text</span>
                    <span className="text-[11px] px-2 py-0.5 rounded"
                          style={{
                            background: 'color-mix(in srgb, var(--warning) 18%, transparent)',
                            color: 'var(--warning)',
                          }}>
                      {plag.flagged_words} of {plag.total_words} words
                    </span>
                  </div>

                  {/* The original text with matching runs marked in place. Spans
                      are character offsets into the text exactly as submitted,
                      so punctuation and capitalisation are preserved. */}
                  <div className="text-[13px] leading-[1.9] px-4 py-3 rounded-xl whitespace-pre-wrap"
                       style={{
                         background: 'rgba(3,7,18,.45)',
                         border: '1px solid var(--border)',
                         color: 'var(--ink-2)',
                       }}>
                    {highlight(text, plag.matched_spans)}
                  </div>
                </div>
              )}

              <p className="text-[11.5px] mt-4 pt-3 border-t leading-relaxed"
                 style={{ color: 'var(--ink-muted)', borderColor: 'var(--border)' }}>
                {plag.note}
              </p>
            </>
          )}
        </Panel>
      )}

      {/* -------------------------------------------------------- AI text --- */}
      {ai && (
        <Panel index={2} title="AI-Generated Content">
          {!ai.available ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>{ai.reason}</p>
          ) : (
            <>
              <ScoreBlock
                label="AI indicator score"
                percent={ai.ai_likelihood_percent}
                verdict={ai.verdict}
                caption={`${ai.word_count} words · ${ai.sentence_count} sentences`}
              />

              <div className="mt-4">
                <Meter value={ai.ai_likelihood_percent / 100} color={colourFor(ai.verdict)} />
              </div>

              <div className="mt-5">
                <div className="text-[12px] mb-2.5" style={{ color: 'var(--ink-2)' }}>
                  What the score is made of
                </div>
                <ul className="space-y-2.5">
                  {ai.signals.map((s, i) => (
                    <li key={s.name} className="fade-in" style={{ '--i': i }}>
                      <div className="flex items-center gap-3 text-[12.5px]">
                        <span className="flex-1">{s.name}</span>
                        <span className="w-24">
                          <Meter value={s.strength / 100} color="var(--brand)" height={4} />
                        </span>
                        <span className="tnum w-12 text-right" style={{ color: 'var(--ink-2)' }}>
                          {s.strength.toFixed(0)}%
                        </span>
                        <span className="tnum w-10 text-right text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          ×{s.weight}%
                        </span>
                      </div>
                      <div className="text-[11px] ml-0.5 mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                        {s.detail}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[12px] leading-relaxed"
                   style={{ color: 'var(--warning)' }}>
                  ⚠ {ai.note}
                </p>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  )
}
