import { useEffect, useRef, useState } from 'react'

import { apiUrl } from '../api.js'

/**
 * OmniGuard Assistant — the in-app help chat.
 *
 * Answers come from the backend's curated knowledge base, which can read live
 * scan data. It is deliberately not a language model, and the header says so:
 * every answer is one a person wrote and can defend, so it cannot invent claims
 * about how this system works.
 */

const GREETING = {
  role: 'assistant',
  text: "Hi — I'm the OmniGuard assistant.\n\nI can explain how the detection works, what any part of a report means, or read your live scan results. What would you like to know?",
}

/** Minimal inline formatter: **bold**, `code`, and - bullet lists. */
function RichText({ text }) {
  const inline = (line, keyPrefix) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={`${keyPrefix}-${i}`} className="px-1 py-0.5 rounded text-[11px]"
                style={{ background: 'var(--surface-3)', color: 'var(--accent)' }}>
            {part.slice(1, -1)}
          </code>
        )
      }
      return <span key={`${keyPrefix}-${i}`}>{part}</span>
    })
  }

  const blocks = []
  let bullets = []

  const flush = (key) => {
    if (!bullets.length) return
    blocks.push(
      <ul key={`ul-${key}`} className="list-disc ml-4 space-y-1 my-1.5">
        {bullets.map((b, i) => <li key={i}>{inline(b, `b${key}-${i}`)}</li>)}
      </ul>
    )
    bullets = []
  }

  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ''))
      return
    }
    flush(i)
    if (line.trim()) {
      blocks.push(<p key={`p-${i}`} className="my-1.5">{inline(line, `l${i}`)}</p>)
    }
  })
  flush('end')

  return <div className="leading-relaxed">{blocks}</div>
}

export default function Assistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [chips, setChips] = useState([
    'How does it work?',
    'What does my last scan mean?',
    'Can I trust the verdict?',
  ])
  const [unseen, setUnseen] = useState(true)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    if (open) {
      setUnseen(false)
      setTimeout(() => inputRef.current?.focus(), 120)
    }
  }, [open])

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const send = async (question) => {
    const text = (question ?? input).trim()
    if (!text || thinking) return

    setMessages((m) => [...m, { role: 'user', text }])
    setInput('')
    setThinking(true)
    setChips([])

    try {
      const body = new FormData()
      body.append('question', text)
      const res = await fetch(apiUrl('/api/assistant'), { method: 'POST', body })
      if (!res.ok) throw new Error(`Assistant unavailable (${res.status})`)
      const data = await res.json()

      // A brief pause reads as considered rather than instant-and-canned.
      await new Promise((r) => setTimeout(r, 260))
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }])
      setChips(data.followups ?? [])
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'assistant',
        text: `I couldn't reach the assistant service — ${e.message}. Is the backend running?`,
      }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center z-50 press ${unseen && !open ? 'halo' : ''}`}
        style={{
          background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
          color: 'var(--on-accent)',
          boxShadow: '0 8px 28px -8px rgba(0, 240, 255, 0.55)',
          transition: 'transform .22s cubic-bezier(0.34, 1.4, 0.64, 1)',
          transform: open ? 'rotate(90deg) scale(0.92)' : 'none',
        }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="OmniGuard assistant"
          className="fixed bottom-24 right-6 z-50 flex flex-col pop-in liquid-glass overflow-hidden"
          style={{
            width: 'min(380px, calc(100vw - 3rem))',
            height: 'min(540px, calc(100vh - 10rem))',
          }}
        >
          <header className="px-4 py-3 flex items-center gap-2.5 border-b shrink-0"
                  style={{
                    borderColor: 'rgba(226,232,240,.10)',
                    background: 'rgba(226,232,240,.05)',
                  }}>
            <img src="/logo-mark.png" alt="" width="128" height="128"
                 className="w-8 h-8 object-contain shrink-0"
                 style={{ filter: 'drop-shadow(0 0 10px rgba(0,240,255,.45))' }}
                 aria-hidden="true" />
            <div className="leading-tight flex-1 min-w-0">
              <div className="text-[13px] font-semibold on-glass">OmniGuard Assistant</div>
              <div className="text-[10px] on-glass" style={{ color: 'var(--ink-2)' }}>
                Answers from a curated knowledge base
              </div>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex bubble-in ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[86%] px-3.5 py-2.5 rounded-2xl text-[12.5px] on-glass ${
                       m.role === 'user' ? 'bubble-glass-accent' : 'bubble-glass'}`}
                     style={m.role === 'user'
                       ? { color: 'var(--ink)', borderBottomRightRadius: 6 }
                       : { color: 'var(--ink)', borderBottomLeftRadius: 6 }}>
                  {m.role === 'user' ? m.text : <RichText text={m.text} />}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex justify-start bubble-in">
                <div className="px-4 py-3 rounded-2xl flex gap-1.5 bubble-glass"
                     style={{ borderBottomLeftRadius: 6 }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full typing-dot"
                          style={{ background: 'var(--brand)', animationDelay: `${i * 0.18}s` }} />
                  ))}
                </div>
              </div>
            )}

            {!thinking && chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {chips.map((c) => (
                  <button key={c} onClick={() => send(c)}
                          className="text-[11px] px-2.5 py-1.5 rounded-full press fade-in"
                          style={{
                            background: 'rgba(226,232,240,.08)',
                            border: '1px solid rgba(0,240,255,.22)',
                            color: 'var(--ink)',
                          }}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send() }}
                className="p-3 border-t flex gap-2 shrink-0"
                style={{ borderColor: 'rgba(226,232,240,.10)',
                         background: 'rgba(3,7,18,.25)' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about the detection…"
              aria-label="Ask the assistant a question"
              className="flex-1 px-3 py-2 rounded-lg text-[12.5px] outline-none"
              style={{ background: 'rgba(3,7,18,.45)',
                       border: '1px solid rgba(226,232,240,.14)',
                       color: 'var(--ink)' }}
            />
            <button type="submit" disabled={!input.trim() || thinking}
                    aria-label="Send message"
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 press disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-2))', color: 'var(--on-accent)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  )
}
