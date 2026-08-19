import { Link } from 'react-router-dom'
import Reveal from './Reveal.jsx'

const COLUMNS = [
  {
    heading: 'Analyse',
    links: [
      { label: 'Media Scanner', to: '/scan' },
      { label: 'Image Verification', to: '/scan?type=image' },
      { label: 'Video Verification', to: '/scan?type=video' },
      { label: 'Face Recognition', to: '/identity' },
    ],
  },
  {
    heading: 'Intelligence',
    links: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Model Comparison', to: '/models' },
      { label: 'Scan History', to: '/history' },
      { label: 'System Status', to: '/system' },
    ],
  },
  {
    heading: 'Not built yet',
    links: [
      { label: 'Audio Verification', to: '/soon/audio' },
      { label: 'Text Verification', to: '/text' },
      { label: 'Live Camera', to: '/soon/camera' },
      { label: 'API Access', to: '/soon/api' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="relative mt-10 border-t"
            style={{ borderColor: 'var(--border)', background: 'rgba(3,7,18,.6)' }}>
      <div className="accent-rule" aria-hidden="true" />

      <div className="max-w-6xl mx-auto px-6 py-14">
        <Reveal from="up" stagger={0.08} className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <img src="/logo.png" alt="OmniGuard AI" width="238" height="96"
                 className="h-10 w-auto object-contain mb-4"
                 style={{ filter: 'drop-shadow(0 0 16px rgba(0,240,255,.3))' }} />
            <p className="text-[13px] leading-relaxed max-w-xs" style={{ color: 'var(--ink-2)' }}>
              Deepfake and AI-generated media detection. Real trained models, running
              locally, explaining every verdict.
            </p>
            <div className="flex items-center gap-2 mt-5 text-[11px]"
                 style={{ color: 'var(--ink-muted)' }}>
              <span className="w-1.5 h-1.5 rounded-full glow-pulse"
                    style={{ background: 'var(--good)' }} aria-hidden="true" />
              Runs entirely on this machine
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="font-display text-[11px] tracking-[0.18em] mb-4"
                  style={{ color: 'var(--brand)' }}>
                {col.heading.toUpperCase()}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to}
                          className="text-[13px] transition-colors hover:text-[var(--ink)]"
                          style={{ color: 'var(--ink-2)' }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </Reveal>

        {/* Static file in /public, so a plain anchor rather than a router Link. */}
        <div className="mt-10 flex flex-wrap gap-3">
          <a href="/Documentation.html" target="_blank" rel="noopener"
             className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] press"
             style={{
               background: 'rgba(0,240,255,.10)',
               border: '1px solid rgba(0,240,255,.34)',
               color: 'var(--ink)',
             }}>
            <span aria-hidden="true">▤</span>
            Technical Documentation
          </a>
          <a href="/Documentation.txt" target="_blank" rel="noopener"
             className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] press"
             style={{
               background: 'rgba(226,232,240,.06)',
               border: '1px solid rgba(226,232,240,.16)',
               color: 'var(--ink-2)',
             }}>
            <span aria-hidden="true">≡</span>
            Plain text
          </a>
          <a href="/docs" target="_blank" rel="noopener"
             className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] press"
             style={{
               background: 'rgba(226,232,240,.06)',
               border: '1px solid rgba(226,232,240,.16)',
               color: 'var(--ink-2)',
             }}>
            <span aria-hidden="true">⌘</span>
            API Reference
          </a>
        </div>

        <div className="mt-8 pt-6 border-t flex flex-wrap gap-4 items-center justify-between text-[12px]"
             style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
          <p>
            Built with PyTorch, ONNX Runtime, OpenCV, FastAPI and React.
            Models fine-tuned on FaceForensics++.
          </p>
          <p>A verdict is evidence, not proof.</p>
        </div>
      </div>
    </footer>
  )
}
