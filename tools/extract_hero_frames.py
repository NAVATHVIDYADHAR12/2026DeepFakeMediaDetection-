"""Turns the hero video into a JPEG image sequence for scroll-scrubbed playback.

Why frames instead of just scrubbing a <video>: browsers cannot seek a compressed
video reliably frame-by-frame. Setting `currentTime` on every scroll event stutters
badly because the decoder has to hunt for the nearest keyframe. An image sequence
gives exact, instant control — it is what Apple-style scroll animations actually do.

The trade-off is payload, which is why this script is aggressive about size:
frames are downscaled and JPEG-optimised, and the total is reported so the cost is
never a surprise.

    python tools/extract_hero_frames.py
    python tools/extract_hero_frames.py --width 1280 --quality 78
    python tools/extract_hero_frames.py --stride 2      # every 2nd frame
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import cv2

PROJECT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = PROJECT / "frontend" / "public" / "Hero section video.mp4"
OUT_DIR = PROJECT / "frontend" / "public" / "hero"


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", type=Path, default=DEFAULT_SRC)
    p.add_argument("--out", type=Path, default=OUT_DIR)
    p.add_argument("--width", type=int, default=1024,
                   help="frame width in px; height follows the aspect ratio")
    p.add_argument("--quality", type=int, default=72, help="JPEG quality 1-100")
    p.add_argument("--stride", type=int, default=1,
                   help="keep every Nth frame (2 halves the payload)")
    p.add_argument("--max-frames", type=int, default=None)
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.src.exists():
        print(f"Video not found: {args.src}", file=sys.stderr)
        return 1

    cap = cv2.VideoCapture(str(args.src))
    if not cap.isOpened():
        print(f"Could not open {args.src}", file=sys.stderr)
        return 1

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"source   : {src_w}x{src_h}  {src_fps:.2f} fps  {total} frames  "
          f"{total / src_fps:.1f}s")

    # Extracting above the source frame rate only duplicates frames, so the
    # ceiling is whatever the file actually contains.
    height = round(src_h * args.width / src_w)
    if height % 2:
        height += 1

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True, exist_ok=True)

    written, index = 0, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if index % args.stride == 0:
            resized = cv2.resize(frame, (args.width, height), interpolation=cv2.INTER_AREA)
            cv2.imwrite(
                str(args.out / f"frame_{written:04d}.jpg"),
                resized,
                [cv2.IMWRITE_JPEG_QUALITY, args.quality,
                 cv2.IMWRITE_JPEG_OPTIMIZE, 1,
                 cv2.IMWRITE_JPEG_PROGRESSIVE, 0],
            )
            written += 1
            if args.max_frames and written >= args.max_frames:
                break

        index += 1

    cap.release()

    sizes = [f.stat().st_size for f in args.out.glob("*.jpg")]
    total_mb = sum(sizes) / 1e6

    # The frontend reads this to know how many frames to preload and what the
    # aspect ratio is, so those numbers never have to be hardcoded in JS.
    manifest = {
        "frames": written,
        "width": args.width,
        "height": height,
        "pattern": "/hero/frame_%04d.jpg",
        "source_fps": round(src_fps, 2),
        "duration_sec": round(total / src_fps, 2) if src_fps else None,
        "quality": args.quality,
        "stride": args.stride,
        "total_bytes": sum(sizes),
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"extracted: {written} frames at {args.width}x{height}, quality {args.quality}")
    print(f"payload  : {total_mb:.1f} MB total, {total_mb / max(written, 1) * 1000:.0f} KB average")
    print(f"manifest : {args.out / 'manifest.json'}")

    if total_mb > 12:
        print("\nNOTE: that is heavy for a web page. Re-run with --stride 2 to halve "
              "the frame count, or --width 854 --quality 65 to shrink each frame.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
