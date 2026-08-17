"""Central configuration. Every tunable number in the system lives here."""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
MODELS_DIR = BACKEND_DIR / "models"
DATA_DIR = BACKEND_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
EVIDENCE_DIR = DATA_DIR / "evidence"
DB_PATH = DATA_DIR / "omniguard.db"

for _d in (DATA_DIR, UPLOAD_DIR, EVIDENCE_DIR, MODELS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- face detection / recognition (OpenCV Zoo models, shipped in models/) ---
YUNET_PATH = MODELS_DIR / "face_detection_yunet.onnx"
SFACE_PATH = MODELS_DIR / "face_recognition_sface.onnx"

FACE_SCORE_THRESHOLD = 0.75   # below this, a detection is discarded
FACE_NMS_THRESHOLD = 0.3
FACE_MARGIN = 0.20            # expand the crop 20% beyond the box; forgery
                              # artifacts concentrate at the blend boundary
MIN_FACE_PIXELS = 48          # faces smaller than this are too low-res to judge

# --- deepfake classifier ---
CLASSIFIER_INPUT_SIZE = 224
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)

# Class index convention, must match the training notebook: 0 = REAL, 1 = FAKE
REAL_IDX, FAKE_IDX = 0, 1

# Verdict bands, applied to the ensemble probability of "fake"
SUSPICIOUS_THRESHOLD = 0.40
FAKE_THRESHOLD = 0.65

# --- video ---
VIDEO_MAX_FRAMES = 32         # evenly sampled across the clip
VIDEO_MAX_SECONDS = 300
TEMPORAL_INCONSISTENCY_THRESHOLD = 0.18   # std-dev of per-frame scores

# --- identity matching (SFace cosine similarity) ---
IDENTITY_MATCH_THRESHOLD = 0.363   # OpenCV's recommended cosine threshold
TRACK_MATCH_THRESHOLD = 0.30       # looser, for following a face across frames
TRACK_IOU_THRESHOLD = 0.30

# --- uploads ---
MAX_UPLOAD_MB = 200
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"}
ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def verdict_from_score(fake_prob: float) -> str:
    """Map an ensemble fake-probability onto the dashboard's three verdict bands."""
    if fake_prob >= FAKE_THRESHOLD:
        return "FAKE"
    if fake_prob >= SUSPICIOUS_THRESHOLD:
        return "SUSPICIOUS"
    return "AUTHENTIC"


def risk_from_score(fake_prob: float) -> str:
    if fake_prob >= 0.80:
        return "HIGH"
    if fake_prob >= FAKE_THRESHOLD:
        return "MEDIUM"
    if fake_prob >= SUSPICIOUS_THRESHOLD:
        return "LOW"
    return "MINIMAL"
