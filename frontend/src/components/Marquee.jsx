import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../hooks.js'

/**
 * Continuous scrolling ticker ("treadmill").
 *
 * Driven by requestAnimationFrame rather than a CSS keyframe, because the
 * controls need to reverse direction and nudge the offset mid-flight — things a
 * keyframe animation cannot do without restarting.
 *
 * The track is rendered twice and the offset wraps at half its width, so the
 * loop is seamless with no visible jump.
 *
 * Pauses on hover and on focus, which stops text sliding away from someone
 * still reading it — and stops entirely under prefers-reduced-motion, where it
 * becomes a normal horizontally scrollable strip.
 */
export default function Marquee({
  items,
  speed = 55,
  className = '',
  initialDirection = -1,   // -1 = right-to-left
  phase = 0,               // seconds of head start, for offsetting stacked rows
  controls = true,
}) {
  const trackRef = useRef(null)
  const offsetRef = useRef(0)
  const rafRef = useRef(null)
  const lastRef = useRef(0)

  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [direction, setDirection] = useState(initialDirection)
  const reduced = prefersReducedMotion()

  const apply = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const half = track.scrollWidth / 2
    if (half > 0) {
      // Wrap in both directions so manual nudges never run off the end.
      if (offsetRef.current <= -half) offsetRef.current += half
      if (offsetRef.current > 0) offsetRef.current -= half
    }
    track.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`
  }, [])

  // Seed the offset once so stacked rows sit at different points in the loop.
  // They all move together — the phase only shifts where each one starts.
  useEffect(() => {
    offsetRef.current = initialDirection * speed * phase
    apply()
  }, [initialDirection, speed, phase, apply])

  useEffect(() => {
    if (reduced) return

    const tick = (now) => {
      const dt = lastRef.current ? (now - lastRef.current) / 1000 : 0
      lastRef.current = now

      if (!paused && !hovered) {
        offsetRef.current += direction * speed * Math.min(dt, 0.05)
        apply()
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      lastRef.current = 0
    }
  }, [paused, hovered, direction, speed, apply, reduced])

  const nudge = (px) => { offsetRef.current += px; apply() }

  const Button = ({ label, onClick, children }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 press on-glass"
      style={{
        background: 'rgba(3,7,18,.55)',
        border: '1px solid rgba(226,232,240,.14)',
        color: 'var(--ink-2)',
      }}
    >
      {children}
    </button>
  )

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-3">
        {controls && (<>
        <Button label="Scroll left" onClick={() => nudge(-160)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>

        <Button label={paused ? 'Resume scrolling' : 'Pause scrolling'}
                onClick={() => setPaused((p) => !p)}>
          {paused ? (
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4l14 8-14 8V4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
              <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
          )}
        </Button>

        <Button label="Scroll right" onClick={() => nudge(160)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>

        <Button label={direction === -1 ? 'Reverse direction' : 'Restore direction'}
                onClick={() => setDirection((d) => -d)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M17 2l4 4-4 4M3 6h18M7 22l-4-4 4-4M21 18H3"
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        </>)}

        {/* The strip itself. Edges fade into the page so items enter and leave
            rather than being chopped off at a hard boundary. */}
        <div
          className="relative flex-1 min-w-0 overflow-hidden py-4"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setHovered(true)}
          onBlurCapture={() => setHovered(false)}
          style={{
            maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
            overflowX: reduced ? 'auto' : 'hidden',
          }}
        >
          <div ref={trackRef} className="flex items-center gap-4 w-max will-change-transform">
            {/* Rendered twice for the seamless wrap. The copy is hidden from
                assistive tech so the text is not announced twice. */}
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-4"
                   aria-hidden={copy === 1 ? 'true' : undefined}>
                {items.map((item, i) => (
                  <span key={`${copy}-${i}`} className="flex items-center gap-4 shrink-0">
                    <span className="text-[13px] whitespace-nowrap font-display tracking-wide"
                          style={{ color: item.accent ? 'var(--brand)' : 'var(--ink-2)' }}>
                      {item.text ?? item}
                    </span>
                    <span aria-hidden="true" className="text-[9px]"
                          style={{ color: 'rgba(0,240,255,.45)' }}>◆</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
