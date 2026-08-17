import { useRef, useState } from 'react'
import { prefersReducedMotion } from '../hooks.js'

/**
 * 3D tilt with a light source that follows the cursor.
 *
 * The tilt is driven straight from pointer position with no easing library:
 * the pointer's offset from the element's centre maps to rotateX/rotateY, and
 * the same coordinates place a radial glow so the highlight tracks the cursor
 * like a reflection.
 *
 * Written directly to `style` via a ref rather than through React state — a
 * setState per mousemove would re-render the subtree on every frame.
 */
export default function TiltCard({
  children,
  className = '',
  max = 9,               // degrees
  glow = 'rgba(0,240,255,.28)',
  scale = 1.02,
}) {
  const ref = useRef(null)
  const glowRef = useRef(null)
  const [active, setActive] = useState(false)
  const reduced = prefersReducedMotion()

  const onMove = (e) => {
    if (reduced) return
    const node = ref.current
    if (!node) return

    const rect = node.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height

    // Centre is (0.5, 0.5); offsets run -0.5..0.5.
    const rx = (0.5 - py) * max * 2
    const ry = (px - 0.5) * max * 2

    node.style.transform =
      `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${scale})`

    if (glowRef.current) {
      glowRef.current.style.background =
        `radial-gradient(circle at ${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%, ${glow}, transparent 55%)`
    }
  }

  const reset = () => {
    setActive(false)
    const node = ref.current
    if (node) node.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)'
  }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={reset}
      className={`relative rounded-2xl ${className}`}
      style={{
        transformStyle: 'preserve-3d',
        transition: 'transform .35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow .35s ease',
        boxShadow: active && !reduced
          ? '0 24px 60px -24px rgba(0,0,0,.9), 0 0 42px -14px rgba(0,240,255,.55)'
          : '0 0 0 0 transparent',
        willChange: 'transform',
      }}
    >
      {children}

      {/* Cursor-tracking sheen, above the content but not interactive. */}
      <div ref={glowRef} aria-hidden="true"
           className="absolute inset-0 rounded-2xl pointer-events-none"
           style={{ opacity: active && !reduced ? 1 : 0, transition: 'opacity .3s ease' }} />

      {/* Rim light that only appears on hover. */}
      <div aria-hidden="true"
           className="absolute inset-0 rounded-2xl pointer-events-none"
           style={{
             border: '1px solid rgba(0,240,255,.45)',
             opacity: active && !reduced ? 1 : 0,
             transition: 'opacity .3s ease',
           }} />
    </div>
  )
}
