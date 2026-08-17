import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../AuthContext.jsx'

/**
 * Sign up / sign in control, or the account menu once signed in.
 *
 * Liquid glass with a glow that blooms on hover. The glow is a sibling layer
 * rather than a box-shadow on the button itself, so it can be blurred without
 * softening the button's own edge.
 */
export default function AuthButton() {
  const { user, loading, signOut } = useAuth()
  const [hover, setHover] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (loading) {
    return <span className="w-[104px] h-[34px] rounded-full shimmer block" aria-hidden="true" />
  }

  // ------------------------------------------------------------ signed out
  if (!user) {
    return (
      <div className="relative shrink-0"
           onMouseEnter={() => setHover(true)}
           onMouseLeave={() => setHover(false)}>
        {/* Blurred bloom behind the button. */}
        <span aria-hidden="true"
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
                filter: 'blur(14px)',
                opacity: hover ? 0.75 : 0,
                transform: hover ? 'scale(1.12)' : 'scale(0.94)',
                transition: 'opacity .32s ease, transform .32s ease',
              }} />

        <Link
          to="/signup"
          className="relative flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap press on-glass"
          style={{
            background: hover
              ? 'linear-gradient(140deg, rgba(0,240,255,.30), rgba(0,240,255,.12))'
              : 'rgba(226,232,240,.07)',
            border: `1px solid ${hover ? 'rgba(0,240,255,.62)' : 'rgba(226,232,240,.16)'}`,
            color: 'var(--ink)',
            backdropFilter: 'blur(12px) saturate(160%)',
            WebkitBackdropFilter: 'blur(12px) saturate(160%)',
            boxShadow: hover ? 'inset 0 1px 0 rgba(255,255,255,.22)' : 'none',
            transition: 'background .3s ease, border-color .3s ease, box-shadow .3s ease',
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--brand)' }}>◇</span>
          <span className="hidden sm:inline">Sign up</span>
          <span className="sm:hidden">Join</span>
        </Link>
      </div>
    )
  }

  // ------------------------------------------------------------- signed in
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-[13px] press on-glass"
        style={{
          background: 'rgba(226,232,240,.07)',
          border: `1px solid ${hover || open ? 'rgba(0,240,255,.55)' : 'rgba(226,232,240,.16)'}`,
          color: 'var(--ink)',
          backdropFilter: 'blur(12px) saturate(160%)',
          boxShadow: hover || open ? '0 0 22px -8px rgba(0,240,255,.75)' : 'none',
          transition: 'border-color .3s ease, box-shadow .3s ease',
        }}
      >
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
                color: 'var(--on-accent)',
              }}
              aria-hidden="true">
          {initials}
        </span>
        <span className="hidden sm:inline max-w-[92px] truncate">{user.name.split(' ')[0]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] w-56 liquid-glass p-2 pop-in z-50"
             role="menu">
          <div className="px-3 py-2 mb-1 border-b" style={{ borderColor: 'rgba(226,232,240,.10)' }}>
            <div className="text-[13px] font-medium truncate">{user.name}</div>
            <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
              {user.email}
            </div>
          </div>

          {[['Dashboard', '/dashboard'], ['Scan History', '/history'], ['Face Recognition', '/identity']]
            .map(([label, to], i) => (
              <button key={to} role="menuitem"
                      onClick={() => { setOpen(false); navigate(to) }}
                      className="w-full text-left px-3 py-2 rounded-lg text-[13px] fade-in"
                      style={{ '--i': i, color: 'var(--ink-2)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,240,255,.12)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                {label}
              </button>
            ))}

          <button role="menuitem"
                  onClick={async () => { setOpen(false); await signOut(); navigate('/') }}
                  className="w-full text-left px-3 py-2 rounded-lg text-[13px] mt-1 border-t"
                  style={{ color: 'var(--critical)', borderColor: 'rgba(226,232,240,.10)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,59,92,.12)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
