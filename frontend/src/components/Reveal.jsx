import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { useScroller } from '../ScrollContext.js'
import { prefersReducedMotion } from '../hooks.js'

gsap.registerPlugin(ScrollTrigger)

const FROM = {
  left:  { x: -64, y: 0,   scale: 1 },
  right: { x: 64,  y: 0,   scale: 1 },
  up:    { x: 0,   y: 48,  scale: 1 },
  down:  { x: 0,   y: -48, scale: 1 },
  scale: { x: 0,   y: 24,  scale: 0.94 },
}

/**
 * Scroll-triggered entrance animation.
 *
 * Wraps children and animates them in when they enter the viewport. With
 * `stagger`, the direct children animate in sequence rather than the wrapper
 * moving as one block — that is what makes a grid of cards arrive one by one.
 *
 * Hiding happens in useLayoutEffect (before the browser paints) rather than via
 * an inline style, for two reasons: there is no flash of un-animated content,
 * and when staggering it is the *children* that must start hidden — hiding the
 * wrapper instead would leave everything invisible, since the tween only ever
 * raises the children's opacity back to 1.
 *
 * The cascade replays on every entry rather than firing once, so scrolling up
 * and back down re-runs it.
 *
 * Under prefers-reduced-motion nothing is hidden at all, so a disabled
 * animation can never mean disappeared content.
 */
export default function Reveal({
  children,
  from = 'up',
  delay = 0,
  duration = 0.9,
  stagger = 0,
  className = '',
  as: Tag = 'div',
  start = 'top 85%',
}) {
  const ref = useRef(null)
  const scroller = useScroller()

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    const targets = stagger ? Array.from(node.children) : node
    if (stagger && targets.length === 0) return

    if (prefersReducedMotion()) {
      gsap.set(targets, { clearProps: 'all' })
      return
    }

    const origin = FROM[from] ?? FROM.up
    const ctx = gsap.context(() => {
      gsap.set(targets, { opacity: 0, x: origin.x, y: origin.y, scale: origin.scale })

      gsap.to(targets, {
        opacity: 1, x: 0, y: 0, scale: 1,
        duration, delay, stagger,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: node,
          scroller: scroller || undefined,
          start,
          // onEnter / onLeave / onEnterBack / onLeaveBack.
          // "restart" on entry means the one-by-one cascade replays every time
          // the block scrolls back into view; "reverse" on leaving upward
          // resets it, so scrolling up and back down replays it too.
          toggleActions: 'restart none none reverse',
        },
      })
    }, node)

    return () => ctx.revert()
  }, [from, delay, duration, stagger, scroller, start])

  return <Tag ref={ref} className={className}>{children}</Tag>
}
