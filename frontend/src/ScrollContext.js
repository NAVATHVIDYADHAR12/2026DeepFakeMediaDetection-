import { createContext, useContext } from 'react'

/**
 * The app scrolls inside a <main> element, not the document. GSAP ScrollTrigger
 * and the scroll-direction hooks both need a handle on that element, so it is
 * shared here rather than threaded through props.
 */
export const ScrollContext = createContext(null)

export const useScroller = () => useContext(ScrollContext)
