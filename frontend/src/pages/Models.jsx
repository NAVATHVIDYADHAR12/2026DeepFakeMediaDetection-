import { useEffect, useState } from 'react'

import { api } from '../api.js'
import { Meter } from '../components/charts.jsx'
import { EmptyState, ModelsMissing, Panel, Spinner } from '../components/ui.jsx'

const METRICS = [
  ['accuracy', 'Accuracy', 'Share of test images judged correctly.'],
  ['precision', 'Precision', 'Of everything called fake, how much really was.'],
  ['recall', 'Recall', 'Of all real fakes, how many were caught.'],
  ['f1', 'F1', 'Harmonic mean of precision and recall.'],
  ['roc_auc', 'ROC-AUC', 'Ranking quality, independent of threshold.'],
]

export default function Models() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { api.models().then(setData).catch((e) => setError(e.message)) }, [])

  if (error) return <EmptyState icon="⚠" title="Could not load models" body={error} />
  if (!data) return <Spinner label="Loading models…" />
  if (!data.ready) return <ModelsMissing />

  const ensemble = data.ensemble_metrics ?? {}
  const rows = [...data.models]
  if (Object.keys(ensemble).length) {
    rows.push({ arch: 'ENSEMBLE', name: 'Ensemble (mean vote)', metrics: ensemble, isEnsemble: true })
  }

  return (
    <div className="space-y-5">
      <Panel title="Model Comparison">
        <p className="text-[13px] -mt-1 mb-4 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Measured on a held-out test set of {data.test_set_size?.toLocaleString() ?? '—'} images the models
          never saw during training. Trained on <code style={{ color: 'var(--ink-2)' }}>{data.trained_on ?? 'unknown source'}</code>.
          These figures come from the training run — nothing here is estimated at runtime.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                <th className="py-2 pr-4 font-medium">Model / Engine</th>
                {METRICS.map(([key, label, hint]) => (
                  <th key={key} className="py-2 pr-4 font-medium" title={hint}>{label}</th>
                ))}
                <th className="py-2 font-medium w-[150px]">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const metrics = m.metrics ?? {}
                const empty = !Object.keys(metrics).length
                return (
                  <tr key={m.arch} className="border-t row-hover" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-3 pr-4 font-medium"
                        style={{ color: m.isEnsemble ? 'var(--accent)' : 'var(--ink)' }}>
                      {m.name}
                    </td>
                    {METRICS.map(([key]) => (
                      <td key={key} className="py-3 pr-4 tnum">
                        {metrics[key] != null ? metrics[key].toFixed(4) : '—'}
                      </td>
                    ))}
                    <td className="py-3">
                      {empty ? <span style={{ color: 'var(--ink-muted)' }}>—</span>
                        : <Meter value={metrics.accuracy ?? 0}
                                 color={m.isEnsemble ? 'var(--accent)' : 'var(--brand)'} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {rows.some((m) => !Object.keys(m.metrics ?? {}).length) && (
          <p className="text-[12px] mt-4 pt-3 border-t"
             style={{ color: 'var(--warning)', borderColor: 'var(--border)' }}>
            ⚠ Some entries have no metrics — that means a placeholder model is loaded, not a trained one.
            Its predictions are meaningless. Replace it with the Colab-trained models.
          </p>
        )}
      </Panel>

      <Panel title="What these numbers mean">
        <dl className="space-y-3 text-[13px]">
          {METRICS.map(([key, label, hint]) => (
            <div key={key}>
              <dt className="font-medium">{label}</dt>
              <dd style={{ color: 'var(--ink-muted)' }}>{hint}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  )
}
