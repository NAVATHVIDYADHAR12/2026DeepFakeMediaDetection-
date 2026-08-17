"""Image analysis orchestration - the path a single still image takes.

    load -> detect faces -> classify each face -> heatmap -> forensics -> report

Kept separate from the web layer so it can be run and tested without a server.
"""

from __future__ import annotations

import base64
import time
import uuid
from pathlib import Path

import cv2
import numpy as np

import config as cfg
import forensics
from detector import colorize_heatmap


def _b64_jpeg(image_bgr: np.ndarray, quality: int = 85, max_side: int = 512) -> str:
    """Encode a preview as a data URI, downscaled to a sensible display size.

    Previews are embedded directly in the JSON report, so a full-resolution
    frame would bloat every response - a 1536px full-frame crop encodes to
    ~158 KB, and a report can carry two previews per face.
    """
    h, w = image_bgr.shape[:2]
    if max(h, w) > max_side:
        scale = max_side / max(h, w)
        image_bgr = cv2.resize(image_bgr, (max(1, int(w * scale)), max(1, int(h * scale))),
                               interpolation=cv2.INTER_AREA)

    ok, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def analyze_image(path: Path, detector, face_analyzer, want_previews: bool = True) -> dict:
    """Full analysis of one image file. Returns the report dict the UI renders."""
    started = time.perf_counter()
    timeline: list[dict] = []

    def mark(stage: str) -> None:
        timeline.append({
            "stage": stage,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
        })

    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"Could not decode image: {path.name}")
    mark("File loaded")

    height, width = image.shape[:2]

    faces = face_analyzer.detect(image)
    mark("Face detection")

    face_reports: list[dict] = []
    # No face found -> still analyse, but on the whole frame, and say so.
    targets = (
        [(f, face_analyzer.crop(image, f["bbox"])) for f in faces]
        if faces else [(None, image)]
    )

    for idx, (face, crop) in enumerate(targets):
        result = detector.predict(crop, want_heatmap=True)
        heatmap = result.pop("heatmap", None)

        entry = {
            "face_id": idx + 1,
            "is_full_frame": face is None,
            "bbox": face["bbox"] if face else [0, 0, float(width), float(height)],
            "detection_score": round(face["score"], 4) if face else None,
            "landmarks": face["landmarks"] if face else None,
            **result,
        }

        if want_previews:
            entry["crop_preview"] = _b64_jpeg(crop)
            if heatmap is not None:
                entry["heatmap_preview"] = _b64_jpeg(colorize_heatmap(heatmap, crop))

        if face is not None:
            emb = face_analyzer.embed(image, face["_raw"])
            entry["has_embedding"] = emb is not None
            entry["_embedding"] = emb.tolist() if emb is not None else None

        face_reports.append(entry)

    mark("Model inference")

    # Overall verdict: the most suspicious face drives the result. One forged
    # face in a group photo makes the whole image manipulated.
    probs = [f["fake_probability"] for f in face_reports]
    overall = float(max(probs)) if probs else 0.0

    metadata = forensics.read_metadata(path)
    mark("Metadata extraction")

    c2pa = forensics.check_c2pa(path)
    mark("Provenance check")

    ela = forensics.error_level_analysis(path)
    mark("Error level analysis")

    findings = forensics.build_findings(
        {"fake_probability": overall,
         "model_agreement": min((f["model_agreement"] for f in face_reports), default=1.0)},
        metadata, c2pa, ela, len(faces),
    )
    mark("Report generated")

    # Per-model rollup for the dashboard's comparison panel
    model_rollup: list[dict] = []
    if face_reports:
        for i, m in enumerate(face_reports[0]["models"]):
            worst = max(f["models"][i]["fake_probability"] for f in face_reports)
            model_rollup.append({
                "arch": m["arch"],
                "name": m["name"],
                "fake_probability": round(worst, 4),
                "verdict": cfg.verdict_from_score(worst),
                "confidence": round(abs(worst - 0.5) * 2, 4),
                "test_accuracy": m.get("test_accuracy"),
                "test_auc": m.get("test_auc"),
            })

    return {
        "scan_id": f"SCN{uuid.uuid4().hex[:6].upper()}",
        "media_type": "image",
        "filename": path.name,
        "file_size_bytes": path.stat().st_size,
        "dimensions": f"{width}x{height}",
        "width": width,
        "height": height,
        "fake_probability": round(overall, 4),
        "authenticity_score": round((1 - overall) * 100, 1),
        "verdict": cfg.verdict_from_score(overall),
        "risk_level": cfg.risk_from_score(overall),
        "confidence": round(abs(overall - 0.5) * 2, 4),
        "faces_detected": len(faces),
        "faces": face_reports,
        "models": model_rollup,
        "metadata": metadata,
        "c2pa": c2pa,
        "ela": ela,
        "findings": findings,
        "timeline": timeline,
        "processing_ms": round((time.perf_counter() - started) * 1000, 1),
    }
