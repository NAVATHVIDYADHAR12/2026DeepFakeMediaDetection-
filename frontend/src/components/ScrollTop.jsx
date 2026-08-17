import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../hooks.js'

/**
 * Back-to-top button.
 *
 * Watches the scrolling container (the <main> element, not the window — the
 * layout keeps the sidebar and header fixed) and fades in once there is enough
 * scrolled past to be worth jumping back over.
 */
export default function ScrollTop({ targetRef, threshold = 320 }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = targetRef?.current
    if (!node) return

    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        setVisible(node.scrollTop > threshold)
        ticking = false
      })
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => node.removeEventListener('scroll', onScroll)
  }, [targetRef, threshold])

  const toTop = () => {
    targetRef.current?.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }

  return (
    <button
      onClick={toTop}
      aria-label="Scroll back to top"
      title="Back to top"
      className="fixed bottom-24 right-6 w-11 h-11 rounded-full flex items-center justify-center z-40 press"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border-bright)',
        color: 'var(--ink-2)',
        backdropFilter: 'blur(8px)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.85)',
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity .25s ease, transform .25s cubic-bezier(0.34, 1.4, 0.64, 1)',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
