import { useMemo } from 'react'
import { prefersReducedMotion } from '../hooks.js'

/**
 * Splits text into per-character spans that rise out of a mask in sequence,
 * like a terminal drawing itself.
 *
 * The whole string stays in the DOM as one accessible label — screen readers
 * get `aria-label`, and the animated glyphs are hidden from them, so this never
 * turns a heading into a pile of unreadable single letters.
 */
export default function LetterReveal({ text, className = '', stagger = 30, as: Tag = 'span' }) {
  const reduced = prefersReducedMotion()

  const letters = useMemo(() => Array.from(text), [text])

  if (reduced) {
    return <Tag className={className}>{text}</Tag>
  }

  return (
    <Tag className={`letter-reveal ${className}`} aria-label={text}>
      {letters.map((ch, i) => (
        <span key={`${ch}-${i}`} aria-hidden="true"
              style={{ '--i': i, animationDelay: `${i * stagger}ms` }}>
          {ch}
        </span>
      ))}
    </Tag>
  )
}
