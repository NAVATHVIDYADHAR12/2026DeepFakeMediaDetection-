/**
 * Central configuration. Every tunable number in the system lives here.
 *
 * A direct port of backend/config.py. The numbers are deliberately identical:
 * they were chosen against the trained models and the dashboard's verdict
 * bands, so changing one here would silently change what the app reports.
 *
 * Deployment-dependent values read from the environment, with defaults that
 * keep local behaviour exactly as it was.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const WEB_DIR = path.resolve(HERE, '..')
export const PROJECT_DIR = path.resolve(WEB_DIR, '..')
export const MODELS_DIR = process.env.OMNIGUARD_MODELS_DIR
  ? path.resolve(process.env.OMNIGUARD_MODELS_DIR)
  : path.join(WEB_DIR, 'models')

// Writable state. Serverless platforms give you only /tmp, and containers
// often mount a volume elsewhere, so the location is overridable.
export const DATA_DIR = process.env.OMNIGUARD_DATA_DIR
  ? path.resolve(process.env.OMNIGUARD_DATA_DIR)
  : path.join(WEB_DIR, 'data')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence')
export const DB_PATH = path.join(DATA_DIR, 'omniguard.db')

/**
 * Create the writable directories.
 *
 * Unlike the Python version this is NOT run at import time. On Vercel the
 * module graph is evaluated during the build, where the data directory is
 * neither writable nor meaningful, and an mkdir there would fail the build.
 * Callers that actually write invoke this first instead.
 */
export function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR, EVIDENCE_DIR]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

// --- deployment ---
export const HOST = process.env.OMNIGUARD_HOST ?? '127.0.0.1'
export const PORT = parseInt(process.env.PORT ?? process.env.OMNIGUARD_PORT ?? '8000', 10)

// Origins allowed to call the API. Local dev origins are always permitted; a
// hosted frontend is added via the environment.
const LOCAL_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:8000', 'http://127.0.0.1:8000',
]
export const ALLOWED_ORIGINS = [
  ...LOCAL_ORIGINS,
  ...(process.env.OMNIGUARD_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
]

// When the frontend is on a different site to the API, the session cookie must
// be SameSite=None and Secure or the browser will not send it. That combination
// requires HTTPS, so it is opt-in rather than the local default.
export const CROSS_SITE_COOKIES = ['1', 'true', 'yes']
  .includes((process.env.OMNIGUARD_CROSS_SITE ?? '').toLowerCase())

// --- face detection / recognition (OpenCV Zoo models, shipped in models/) ---
export const YUNET_PATH = path.join(MODELS_DIR, 'face_detection_yunet.onnx')
export const SFACE_PATH = path.join(MODELS_DIR, 'face_recognition_sface.onnx')

export const FACE_SCORE_THRESHOLD = 0.75   // below this, a detection is discarded
export const FACE_NMS_THRESHOLD = 0.3
export const FACE_MARGIN = 0.20            // expand the crop 20% beyond the box; forgery
                                           // artifacts concentrate at the blend boundary
export const MIN_FACE_PIXELS = 48          // faces smaller than this are too low-res to judge

// --- deepfake classifier ---
export const CLASSIFIER_INPUT_SIZE = 224
export const IMAGENET_MEAN = [0.485, 0.456, 0.406]
export const IMAGENET_STD = [0.229, 0.224, 0.225]

// Class index convention, must match the training notebook: 0 = REAL, 1 = FAKE
export const REAL_IDX = 0
export const FAKE_IDX = 1

// Verdict bands, applied to the ensemble probability of "fake"
export const SUSPICIOUS_THRESHOLD = 0.40
export const FAKE_THRESHOLD = 0.65

// --- video ---
export const VIDEO_MAX_FRAMES = 32         // evenly sampled across the clip
export const VIDEO_MAX_SECONDS = 300
export const TEMPORAL_INCONSISTENCY_THRESHOLD = 0.18   // std-dev of per-frame scores

// --- identity matching (SFace cosine similarity) ---
export const IDENTITY_MATCH_THRESHOLD = 0.363   // OpenCV's recommended cosine threshold
export const TRACK_MATCH_THRESHOLD = 0.30       // looser, for following a face across frames
export const TRACK_IOU_THRESHOLD = 0.30

// --- uploads ---
export const MAX_UPLOAD_MB = 200
export const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff'])
export const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])

/** Map an ensemble fake-probability onto the dashboard's three verdict bands. */
export function verdictFromScore(fakeProb) {
  if (fakeProb >= FAKE_THRESHOLD) return 'FAKE'
  if (fakeProb >= SUSPICIOUS_THRESHOLD) return 'SUSPICIOUS'
  return 'AUTHENTIC'
}

export function riskFromScore(fakeProb) {
  if (fakeProb >= 0.80) return 'HIGH'
  if (fakeProb >= FAKE_THRESHOLD) return 'MEDIUM'
  if (fakeProb >= SUSPICIOUS_THRESHOLD) return 'LOW'
  return 'MINIMAL'
}
