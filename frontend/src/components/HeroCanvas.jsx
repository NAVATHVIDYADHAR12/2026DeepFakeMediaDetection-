import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { useScroller } from '../ScrollContext.js'
import { prefersReducedMotion } from '../hooks.js'

gsap.registerPlugin(ScrollTrigger)

/**
 * Scroll-scrubbed image sequence.
 *
 * The hero video was exported to a JPEG sequence by tools/extract_hero_frames.py,
 * because browsers cannot seek compressed video frame-by-frame without stuttering —
 * setting `currentTime` on every scroll event makes the decoder hunt for keyframes.
 * Painting pre-decoded stills to a canvas gives exact, instant control.
 *
 * Frames are preloaded before the scrub is wired up, so scrolling never lands on
 * a blank frame. Under prefers-reduced-motion the sequence is not scrubbed at all —
 * a single representative still is drawn and left alone.
 */
export default function HeroCanvas({ className = '', onReady }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const imagesRef = useRef([])
  const frameRef = useRef({ i: 0 })
  const scroller = useScroller()

  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let trigger = null

    const draw = () => {
      const canvas = canvasRef.current
      const img = imagesRef.current[Math.round(frameRef.current.i)]
      if (!canvas || !img) return

      const ctx = canvas.getContext('2d', { alpha: false })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // object-fit: cover, computed by hand since canvas has no such property
      const scale = Math.max(w / img.width, h / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.fillStyle = '#030712'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }

    const start = async () => {
      let manifest
      try {
        const res = await fetch('/hero/manifest.json')
        if (!res.ok) throw new Error(String(res.status))
        manifest = await res.json()
      } catch {
        if (!cancelled) { setFailed(true); onReady?.() }
        return
      }

      const total = manifest.frames
      let loaded = 0

      const load = (i) => new Promise((resolve) => {
        const img = new Image()
        img.decoding = 'async'
        img.onload = img.onerror = () => {
          loaded += 1
          if (!cancelled) setProgress(loaded / total)
          resolve(img)
        }
        img.src = `/hero/frame_${String(i).padStart(4, '0')}.jpg`
      })

      // First frame first so something can paint immediately, then the rest.
      imagesRef.current[0] = await load(0)
      if (cancelled) return
      draw()

      imagesRef.current = await Promise.all(
        Array.from({ length: total }, (_, i) => (i === 0 ? imagesRef.current[0] : load(i)))
      )
      if (cancelled) return

      setReady(true)
      onReady?.()
      draw()

      if (prefersReducedMotion()) return   // static still, no scrub

      trigger = gsap.to(frameRef.current, {
        i: total - 1,
        ease: 'none',
        snap: 'i',
        scrollTrigger: {
          trigger: wrapRef.current,
          scroller: scroller || undefined,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.5,
        },
        onUpdate: draw,
      })

      ScrollTrigger.refresh()
    }

    start()
    const onResize = () => draw()
    window.addEventListener('resize', onResize)

    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      window.removeEventListener('resize', onResize)
      trigger?.scrollTrigger?.kill()
      trigger?.kill()
    }
  }, [scroller, onReady])

  return (
    <div ref={wrapRef} className={`absolute inset-0 ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block"
              aria-label="Deepfake detection visualisation" role="img" />

      {/* Legibility scrim. The hero copy sits on top of moving footage, so the
          frame is darkened and vignetted rather than relying on text shadow. */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true"
           style={{
             background:
               'radial-gradient(ellipse 80% 60% at 50% 45%, rgba(3,7,18,.35) 0%, rgba(3,7,18,.82) 70%, rgba(3,7,18,.96) 100%),' +
               'linear-gradient(to bottom, rgba(3,7,18,.7) 0%, transparent 25%, transparent 60%, rgba(3,7,18,.98) 100%)',
           }} />

      {!ready && !failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
             style={{ background: 'var(--plane)' }}>
          <div className="w-40 h-px overflow-hidden" style={{ background: 'rgba(226,232,240,.12)' }}>
            <div style={{
              width: `${Math.round(progress * 100)}%`, height: '100%',
              background: 'var(--brand)', transition: 'width .2s linear',
              boxShadow: '0 0 12px var(--brand)',
            }} />
          </div>
          <div className="text-[11px] tracking-[0.2em] font-display"
               style={{ color: 'var(--ink-muted)' }}>
            LOADING {Math.round(progress * 100)}%
          </div>
        </div>
      )}

      {failed && (
        <div className="absolute inset-0" aria-hidden="true"
             style={{
               background:
                 'radial-gradient(ellipse at 50% 40%, rgba(0,240,255,.18), transparent 60%), var(--plane)',
             }} />
      )}
    </div>
  )
}
