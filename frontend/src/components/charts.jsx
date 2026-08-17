import { useEffect, useState, useId } from 'react'

/** Flips to true one frame after mount, so CSS transitions have a value to
 *  animate away from rather than starting at their final state. */
function useMounted(delay = 60) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  return mounted
}

/* ---------------------------------------------------------------------------
   Hand-rolled SVG charts.

   Deliberately dependency-free: these are three simple forms, and a charting
   library would cost more bytes than the charts do. Built to the house rules -
   thin marks, a 2px surface gap between adjacent fills, 4px rounded data ends,
   recessive grid, a hover layer on every plot, and a legend whenever there is
   more than one series so identity never rests on color alone.
--------------------------------------------------------------------------- */

const SURFACE = 'var(--surface-1)'

/* ------------------------------------------------------------------- donut */
/**
 * Authenticity distribution. Segments are status-colored and always labeled.
 * The center carries the headline figure, so the chart answers its question
 * without the reader decoding arc lengths.
 */
export function Donut({ segments, centerValue, centerLabel, size = 190, thickness = 22 }) {
  const [hover, setHover] = useState(null)
  const mounted = useMounted()

  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const GAP = 2 // px of surface between adjacent segments

  let offset = 0
  const arcs = segments.map((seg) => {
    const fraction = total > 0 ? seg.value / total : 0
    const length = Math.max(0, fraction * circumference - GAP)
    const arc = { ...seg, length, offset, fraction }
    offset += fraction * circumference
    return arc
  })

  const active = hover !== null ? arcs[hover] : null

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img"
             aria-label={`Authenticity distribution: ${segments.map(s => `${s.label} ${s.value}`).join(', ')}`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={radius}
                    fill="none" stroke="var(--grid)" strokeWidth={thickness} />
            {arcs.map((arc, i) => (
              <circle
                key={arc.label}
                cx={size / 2} cy={size / 2} r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={hover === i ? thickness + 4 : thickness}
                // Arcs sweep out from zero on first paint.
                strokeDasharray={`${mounted ? arc.length : 0} ${circumference}`}
                strokeDashoffset={-arc.offset}
                strokeLinecap="butt"
                style={{
                  transition: 'stroke-width .15s, stroke-dasharray .9s cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${i * 90}ms`,
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-3xl font-bold" style={{ color: active ? active.color : 'var(--ink)' }}>
            {active ? `${(active.fraction * 100).toFixed(1)}%` : centerValue}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {active ? active.label : centerLabel}
          </div>
        </div>
      </div>

      {/* Legend: color + icon + label + value, so identity survives CVD and print */}
      <ul className="space-y-2.5 min-w-[168px]">
        {arcs.map((arc, i) => (
          <li key={arc.label}
              className="flex items-center gap-2.5 text-sm cursor-pointer rounded px-1 py-0.5"
              style={{ background: hover === i ? 'rgba(255,255,255,.05)' : 'transparent' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: arc.color }} />
            <span className="flex-1" style={{ color: 'var(--ink-2)' }}>{arc.label}</span>
            <span className="tnum font-semibold">{(arc.fraction * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* --------------------------------------------------------------- sparkline */
/** Single-series trend for stat tiles. One series needs no legend - the tile
 *  title names it. */
export function Sparkline({ values, color = 'var(--brand)', width = 84, height = 30 }) {
  // Hooks must run unconditionally, so this precedes the empty-data guard.
  const gradientId = useId()

  if (!values || values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - ((v - min) / span) * (height - 4) - 2,
  ])
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${points[0][0]},${height} ${line} ${points.at(-1)[0]},${height}`

  return (
    <svg width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* -------------------------------------------------------------- meter bar */
/** Horizontal magnitude bar with a 4px rounded data end anchored to the
 *  baseline, as used in the model comparison table. */
export function Meter({ value, color, height = 6 }) {
  const mounted = useMounted()
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: 'var(--grid)' }}>
      <div style={{
        width: mounted ? `${pct}%` : '0%',
        height: '100%',
        background: color,
        borderRadius: 4,
        transition: 'width .75s cubic-bezier(0.22, 1, 0.36, 1)',
      }} />
    </div>
  )
}

/* ---------------------------------------------------------- frame timeline */
/**
 * Per-frame fake probability across a video, with a crosshair + tooltip.
 *
 * The threshold rules are drawn as hairlines so a reader can see *why* a frame
 * was called suspicious rather than having to infer the cut-offs.
 */
export function FrameTimeline({ frames, height = 150 }) {
  const [hover, setHover] = useState(null)
  const gradientId = useId()
  const scored = (frames ?? []).filter((f) => f.fake_probability !== null)

  if (scored.length < 2) {
    return (
      <div className="text-sm py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
        Not enough scored frames to plot a timeline.
      </div>
    )
  }

  const W = 100 // viewBox units; the SVG scales to its container
  const pad = { top: 8, bottom: 18 }
  const plotH = height - pad.top - pad.bottom

  const x = (i) => (i / (scored.length - 1)) * W
  const y = (v) => pad.top + (1 - v) * plotH

  const line = scored.map((f, i) => `${x(i).toFixed(2)},${y(f.fake_probability).toFixed(2)}`).join(' ')
  const area = `0,${height - pad.bottom} ${line} ${W},${height - pad.bottom}`

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const idx = Math.round(ratio * (scored.length - 1))
    setHover(Math.max(0, Math.min(scored.length - 1, idx)))
  }

  const point = hover !== null ? scored[hover] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}
           preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
           role="img" aria-label="Fake probability per sampled video frame">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* threshold rules - recessive, dashed, labeled outside the plot */}
        {[
          { v: 0.65, color: 'var(--critical)' },
          { v: 0.40, color: 'var(--warning)' },
        ].map((rule) => (
          <line key={rule.v} x1="0" x2={W} y1={y(rule.v)} y2={y(rule.v)}
                stroke={rule.color} strokeWidth="0.4" strokeDasharray="1.5 1.5" opacity="0.55"
                vectorEffect="non-scaling-stroke" />
        ))}

        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="2"
                  strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

        {point && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom}
                  stroke="var(--border-bright)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {/* 2px surface ring keeps the marker readable over the line */}
            <circle cx={x(hover)} cy={y(point.fake_probability)} r="4"
                    fill="var(--brand)" stroke={SURFACE} strokeWidth="2"
                    vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      <div className="flex justify-between text-[11px] tnum -mt-3" style={{ color: 'var(--ink-muted)' }}>
        <span>{scored[0].timestamp_sec ?? 0}s</span>
        <span>threshold: fake ≥ 0.65 · suspicious ≥ 0.40</span>
        <span>{scored.at(-1).timestamp_sec ?? ''}s</span>
      </div>

      {point && (
        <div className="absolute top-0 right-0 panel px-3 py-2 text-xs pointer-events-none"
             style={{ background: 'var(--surface-2)' }}>
          <div className="tnum" style={{ color: 'var(--ink-muted)' }}>
            frame {point.frame}{point.timestamp_sec != null ? ` · ${point.timestamp_sec}s` : ''}
          </div>
          <div className="tnum font-semibold">
            fake probability {(point.fake_probability * 100).toFixed(1)}%
          </div>
          <div style={{ color: 'var(--ink-muted)' }}>{point.faces} face(s)</div>
        </div>
      )}
    </div>
  )
}
