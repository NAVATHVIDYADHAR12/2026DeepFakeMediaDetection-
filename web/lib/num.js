/**
 * Numeric helpers that match Python's behaviour.
 *
 * Ported code compares against numbers the Python produced, so "close enough"
 * is not good enough - a dashboard tile reading 33.3 where the old one read
 * 33.4 is a visible regression even though nothing is broken.
 */

/**
 * Round half to even, the way Python's round() and format() do.
 *
 * JavaScript's toFixed and Math.round both round halves away from zero. That
 * differs from Python on every exact tie, and ties are common here because
 * these statistics are ratios of small integers: 69 words over 4 sentences is
 * exactly 17.25, which Python renders "17.2" and toFixed renders "17.3".
 *
 * Scaling by a power of ten carries its own rounding error, but it errs in the
 * same direction Python's does, because both read the same underlying binary
 * value: round(2.675, 2) is 2.67 in both, since 2.675 is really 2.67499...
 */
export function pyRound(x, n = 0) {
  const p = 10 ** n
  const scaled = x * p
  const low = Math.floor(scaled)
  const diff = scaled - low
  if (diff > 0.5) return (low + 1) / p
  if (diff < 0.5) return low / p
  return (low % 2 === 0 ? low : low + 1) / p   // exact tie -> nearest even
}

/** Python's f"{x:.nf}": round half to even, then pad to n decimals. */
export const pyFixed = (x, n) => pyRound(x, n).toFixed(n)

export const round1 = (x) => pyRound(x, 1)

export const clamp01 = (x) => Math.max(0, Math.min(1, x))
