import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '../AuthContext.jsx'

/** Live password strength feedback, mirroring the server's actual rules. */
function strengthOf(password) {
  if (!password) return { score: 0, label: '', colour: 'var(--ink-muted)' }

  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 14) score += 1
  if (/[a-zA-Z]/.test(password) && /\d/.test(password)) score += 1
  if (/[^a-zA-Z0-9]/.test(password)) score += 1

  // The server rejects all-letters and all-digits outright.
  if (password.length < 8 || /^[a-zA-Z]+$/.test(password) || /^\d+$/.test(password)) {
    return { score: 1, label: 'Too weak — mix letters and numbers, 8+ characters',
             colour: 'var(--critical)' }
  }
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const colours = ['', 'var(--critical)', 'var(--warning)', 'var(--brand)', 'var(--good)']
  return { score, label: labels[score], colour: colours[score] }
}

function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="text-[12px] mb-1.5 block" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <input
        {...props}
        className="w-full px-4 py-2.5 rounded-xl text-[14px] outline-none transition-colors"
        style={{
          background: 'rgba(3,7,18,.55)',
          border: '1px solid rgba(226,232,240,.14)',
          color: 'var(--ink)',
        }}
        onFocus={(e) => { e.target.style.borderColor = 'rgba(0,240,255,.5)' }}
        onBlur={(e) => { e.target.style.borderColor = 'rgba(226,232,240,.14)' }}
      />
      {hint && <span className="text-[11px] mt-1.5 block" style={{ color: 'var(--ink-muted)' }}>{hint}</span>}
    </label>
  )
}

export default function SignUp() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user, signUp, signIn } = useAuth()

  const [mode, setMode] = useState(params.get('mode') === 'login' ? 'login' : 'signup')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Already signed in? There is nothing to do on this page.
  useEffect(() => { if (user) navigate('/dashboard', { replace: true }) }, [user, navigate])

  const strength = strengthOf(form.password)
  const isSignup = mode === 'signup'

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (isSignup) await signUp(form.email, form.name, form.password)
      else await signIn(form.email, form.password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="relative min-h-[88vh] flex items-center justify-center px-4 py-10">
      {/* Ambient background: the hero footage, muted, looping, blurred.
          `fixed inset-0` rather than `absolute` — absolute only covered this
          page's own box inside the padded <main>, which is why it was barely
          visible. Fixed makes it fill the whole viewport.
          aria-hidden + pointer-events-none: it is decoration and must never
          intercept a click meant for the form. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0"
           aria-hidden="true">
        <video
          src="/hero-loop.mp4"
          autoPlay
          loop
          muted
          playsInline
          // Chrome only honours autoplay when the element is genuinely muted;
          // the attribute alone is not always enough before hydration.
          ref={(el) => { if (el) el.muted = true }}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            // Lighter blur and a brighter image than before: at 26px/0.55 the
            // motion was unreadable. The card carries its own backdrop blur, so
            // the page behind it does not need to do the work twice.
            filter: 'blur(18px) saturate(145%) brightness(0.85)',
            // Scaled up so the blur's soft edges never expose the page behind.
            transform: 'scale(1.12)',
          }}
        />
        {/* Scrim: dark enough to keep the form legible over moving footage,
            light enough that the footage still reads as footage. */}
        <div className="absolute inset-0"
             style={{
               background:
                 'radial-gradient(ellipse 70% 70% at 50% 50%, rgba(3,7,18,.42) 0%, rgba(3,7,18,.74) 65%, rgba(3,7,18,.92) 100%)',
             }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="liquid-glass p-8 pop-in">
          <div className="text-center mb-7">
            <img src="/logo-mark.png" alt="" width="128" height="128"
                 className="w-12 h-12 mx-auto mb-4 object-contain"
                 style={{ filter: 'drop-shadow(0 0 16px rgba(0,240,255,.5))' }}
                 aria-hidden="true" />
            <h1 className="font-display font-bold text-2xl mb-1.5 headline-animated">
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              {isSignup
                ? 'Saves your scan history and enrolled faces on this machine.'
                : 'Sign in to pick up where you left off.'}
            </p>
          </div>

          {/* Mode switch */}
          <div className="flex gap-1 p-1 rounded-xl mb-6"
               style={{ background: 'rgba(3,7,18,.5)', border: '1px solid rgba(226,232,240,.10)' }}>
            {[['signup', 'Sign up'], ['login', 'Sign in']].map(([key, label]) => (
              <button key={key} type="button"
                      onClick={() => { setMode(key); setError(null) }}
                      className="flex-1 py-2 rounded-lg text-[13px] font-medium transition-all press"
                      style={mode === key ? {
                        background: 'linear-gradient(140deg, rgba(0,240,255,.24), rgba(0,240,255,.10))',
                        border: '1px solid rgba(0,240,255,.42)',
                        color: 'var(--ink)',
                      } : { border: '1px solid transparent', color: 'var(--ink-2)' }}>
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {isSignup && (
              <Field label="Name" type="text" required autoComplete="name"
                     placeholder="Ada Lovelace"
                     value={form.name} onChange={set('name')} />
            )}

            <Field label="Email" type="email" required autoComplete="email"
                   placeholder="you@example.com"
                   value={form.email} onChange={set('email')} />

            <div>
              <Field label="Password" type="password" required
                     autoComplete={isSignup ? 'new-password' : 'current-password'}
                     placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
                     value={form.password} onChange={set('password')} />

              {isSignup && form.password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1.5">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className="h-1 flex-1 rounded-full transition-colors"
                            style={{
                              background: i <= strength.score ? strength.colour : 'rgba(226,232,240,.10)',
                            }} />
                    ))}
                  </div>
                  <span className="text-[11px]" style={{ color: strength.colour }}>
                    {strength.label}
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div className="px-3.5 py-2.5 rounded-xl text-[13px]"
                   role="alert"
                   style={{
                     background: 'color-mix(in srgb, var(--critical) 14%, transparent)',
                     border: '1px solid color-mix(in srgb, var(--critical) 36%, transparent)',
                     color: 'var(--ink)',
                   }}>
                <strong style={{ color: 'var(--critical)' }}>✕ </strong>{error}
              </div>
            )}

            <button type="submit" disabled={busy}
                    className="w-full py-3 rounded-xl text-sm font-semibold press disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
                      color: 'var(--on-accent)',
                      boxShadow: '0 0 30px -10px rgba(0,240,255,.8)',
                    }}>
              {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="text-[11px] mt-6 leading-relaxed text-center"
             style={{ color: 'var(--ink-muted)' }}>
            Accounts are stored locally in this app's SQLite database. Passwords are
            hashed with scrypt and a per-account salt — never stored in plain text,
            and never sent anywhere.
          </p>
        </div>

        <p className="text-center text-[12px] mt-5">
          <Link to="/" style={{ color: 'var(--ink-2)' }}>← Back to home</Link>
        </p>
      </div>
    </div>
  )
}
