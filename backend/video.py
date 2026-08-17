"""Video analysis.

A video is not analysed frame-by-frame end to end - that would take minutes on a
CPU. Instead we sample frames evenly across the clip, classify every face in
each, and then aggregate along two axes:

  * per person  - the tracker follows each face, so one forged person in a
                  two-person interview is not diluted by the genuine one
  * over time   - the standard deviation of a person's score across frames.
                  A real face scores consistently; a swapped face flickers as
                  the generator struggles with pose, blinking and occlusion.
                  That flicker is the "temporal inconsistency" signal.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path

import cv2
import numpy as np

import config as cfg
import forensics
from faces import FaceTracker
from pipeline import _b64_jpeg
from detector import colorize_heatmap


def _probe(cap: cv2.VideoCapture) -> dict:
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = (total / fps) if fps > 0 and total > 0 else 0.0
    return {"fps": fps, "frame_count": total, "width": width,
            "height": height, "duration_sec": duration}


def analyze_video(path: Path, detector, face_analyzer,
                  max_frames: int | None = None) -> dict:
    started = time.perf_counter()
    max_frames = max_frames or cfg.VIDEO_MAX_FRAMES
    timeline: list[dict] = []

    def mark(stage: str) -> None:
        timeline.append({
            "stage": stage,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
        })

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {path.name}")

    meta = _probe(cap)
    mark("File loaded")

    total = meta["frame_count"]
    if total <= 0:
        # Some containers do not report a frame count; fall back to sequential reads.
        indices = list(range(max_frames))
    else:
        indices = np.linspace(0, max(total - 1, 0), min(max_frames, total)).astype(int).tolist()

    tracker = FaceTracker()
    frame_scores: list[dict] = []
    best_frame = None      # most suspicious frame, kept for the report thumbnail
    best_score = -1.0
    frames_analyzed = 0
    frames_with_faces = 0
    # Per-architecture peak score, so video reports carry the same model
    # comparison table that image reports do.
    model_peaks: dict[str, dict] = {}

    for position, frame_idx in enumerate(indices):
        if total > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        frames_analyzed += 1

        faces = face_analyzer.detect(frame)
        if not faces:
            frame_scores.append({
                "frame": int(frame_idx),
                "timestamp_sec": round(frame_idx / meta["fps"], 2) if meta["fps"] else None,
                "faces": 0,
                "fake_probability": None,
            })
            continue

        frames_with_faces += 1
        detections, per_face = [], []

        for face in faces:
            crop = face_analyzer.crop(frame, face["bbox"])
            result = detector.predict(crop, want_heatmap=False)
            emb = face_analyzer.embed(frame, face["_raw"])

            detections.append({
                "bbox": face["bbox"],
                "embedding": emb.tolist() if emb is not None else None,
                "fake_probability": result["fake_probability"],
            })
            per_face.append(result["fake_probability"])

            for m in result["models"]:
                peak = model_peaks.setdefault(m["arch"], {
                    "arch": m["arch"], "name": m["name"], "fake_probability": 0.0,
                    "test_accuracy": m.get("test_accuracy"), "test_auc": m.get("test_auc"),
                })
                peak["fake_probability"] = max(peak["fake_probability"], m["fake_probability"])

        tracker.update(int(frame_idx), detections)

        worst = float(max(per_face))
        frame_scores.append({
            "frame": int(frame_idx),
            "timestamp_sec": round(frame_idx / meta["fps"], 2) if meta["fps"] else None,
            "faces": len(faces),
            "fake_probability": round(worst, 4),
        })

        if worst > best_score:
            best_score = worst
            worst_idx = int(np.argmax(per_face))
            best_crop = face_analyzer.crop(frame, faces[worst_idx]["bbox"])
            hm = detector.predict(best_crop, want_heatmap=True).get("heatmap")
            best_frame = {
                "frame": int(frame_idx),
                "timestamp_sec": round(frame_idx / meta["fps"], 2) if meta["fps"] else None,
                "fake_probability": round(worst, 4),
                "preview": _b64_jpeg(best_crop),
                "heatmap_preview": _b64_jpeg(colorize_heatmap(hm, best_crop)) if hm is not None else None,
            }

    cap.release()
    mark("Frame analysis")

    tracks = tracker.summary()

    scored = [f["fake_probability"] for f in frame_scores if f["fake_probability"] is not None]
    if scored:
        arr = np.asarray(scored, dtype=np.float32)
        mean_score = float(arr.mean())
        # Weight the peak: a convincing fake only breaks down in some frames.
        overall = float(0.6 * arr.max() + 0.4 * mean_score)
        temporal_std = float(arr.std())
    else:
        mean_score = overall = temporal_std = 0.0

    inconsistent = temporal_std > cfg.TEMPORAL_INCONSISTENCY_THRESHOLD

    metadata = forensics.read_metadata(path)
    c2pa = forensics.check_c2pa(path)
    mark("Provenance check")

    findings = forensics.build_findings(
        {"fake_probability": overall, "model_agreement": 1.0},
        metadata, c2pa, {"suspicious_regions": False},
        frames_with_faces and max((f["faces"] for f in frame_scores), default=0),
    )
    if inconsistent:
        findings.insert(1, {
            "severity": "high",
            "text": f"Temporal inconsistency across frames (sigma={temporal_std:.3f})",
        })
    if len(tracks) > 1:
        findings.append({
            "severity": "info",
            "text": f"{len(tracks)} distinct people tracked through the clip",
        })
    mark("Report generated")

    return {
        "scan_id": f"SCN{uuid.uuid4().hex[:6].upper()}",
        "media_type": "video",
        "filename": path.name,
        "file_size_bytes": path.stat().st_size,
        "dimensions": f"{meta['width']}x{meta['height']}",
        "duration_sec": round(meta["duration_sec"], 2),
        "fps": round(meta["fps"], 2),
        "total_frames": meta["frame_count"],
        "frames_analyzed": frames_analyzed,
        "frames_with_faces": frames_with_faces,
        "fake_probability": round(overall, 4),
        "authenticity_score": round((1 - overall) * 100, 1),
        "verdict": cfg.verdict_from_score(overall),
        "risk_level": cfg.risk_from_score(overall),
        "confidence": round(abs(overall - 0.5) * 2, 4),
        "mean_frame_score": round(mean_score, 4),
        "temporal_std": round(temporal_std, 4),
        "temporally_inconsistent": bool(inconsistent),
        "frame_scores": frame_scores,
        "models": [
            {**m,
             "fake_probability": round(m["fake_probability"], 4),
             "verdict": cfg.verdict_from_score(m["fake_probability"]),
             "confidence": round(abs(m["fake_probability"] - 0.5) * 2, 4)}
            for m in model_peaks.values()
        ],
        "tracks": tracks,
        "people_detected": len(tracks),
        "most_suspicious_frame": best_frame,
        "metadata": metadata,
        "c2pa": c2pa,
        "findings": findings,
        "timeline": timeline,
        "processing_ms": round((time.perf_counter() - started) * 1000, 1),
    }
