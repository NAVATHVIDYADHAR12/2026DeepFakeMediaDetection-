import { Link, useParams } from 'react-router-dom'
import { Panel } from '../components/ui.jsx'

/* Honest placeholders. The prototype detects image and video; everything else
   is labelled as not built rather than shown as a dead control. */
const TOPICS = {
  audio: {
    title: 'Audio Verification',
    body: 'Voice-cloning detection. The planned approach is a CNN over mel-spectrograms trained on ASVspoof / WaveFake, which is a separate model and training run from the visual pipeline.',
  },
  text: {
    title: 'Text Verification',
    body: 'AI-generated text detection. A fundamentally different problem from image forensics — it needs a language model, not a vision model.',
  },
  provenance: {
    title: 'Provenance Checker',
    body: 'Full C2PA manifest parsing with cryptographic validation against a trust list. The scanner already reports whether a credential is present; verifying its signature is the next step.',
  },
  camera: {
    title: 'Live Camera',
    body: 'Real-time webcam analysis. The inference path already runs fast enough on CPU; this needs the capture and streaming layer.',
  },
  mic: { title: 'Live Microphone', body: 'Real-time audio capture. Depends on Audio Verification landing first.' },
  threats: { title: 'Threat Intelligence', body: 'Feeds of known deepfake campaigns and hashes of previously seen manipulated media.' },
  analytics: { title: 'Analytics', body: 'Longer-range trend reporting across scans. The dashboard already covers the last 14 days.' },
  evidence: { title: 'Evidence Library', body: 'Case management with chain-of-custody records for scanned media.' },
  api: { title: 'API Access', body: 'Key management and rate limiting. The REST API itself is live now and documented at /docs.' },
}

export default function ComingSoon({ notFound = false }) {
  const { topic } = useParams()
  const info = TOPICS[topic]

  return (
    <div className="max-w-2xl mx-auto">
      <Panel>
        <div className="text-center py-10 px-4">
          <div className="text-4xl mb-4" aria-hidden="true" style={{ color: 'var(--ink-muted)' }}>
            {notFound ? '∅' : '⏳'}
          </div>
          <h1 className="text-xl font-bold mb-2">
            {notFound ? 'Page not found' : (info?.title ?? 'Not built yet')}
          </h1>
          <p className="text-sm leading-relaxed max-w-md mx-auto" style={{ color: 'var(--ink-muted)' }}>
            {notFound
              ? 'That route does not exist.'
              : (info?.body ?? 'This module is not part of the current prototype.')}
          </p>

          {!notFound && (
            <p className="text-[13px] mt-5 px-4 py-3 rounded-lg inline-block"
               style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
              This prototype detects <strong>images and video</strong> with real trained models.
              Nothing on this page is faked with placeholder data.
            </p>
          )}

          <div className="mt-6">
            <Link to="/scan" className="px-5 py-2 rounded-lg text-sm font-medium inline-block"
                  style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-2))', color: 'var(--on-accent)' }}>
              Go to Media Scanner
            </Link>
          </div>
        </div>
      </Panel>
    </div>
  )
}
