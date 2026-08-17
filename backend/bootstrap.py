"""First-boot setup for a fresh deployment.

The two OpenCV face models total ~38 MB and are not committed to the
repository, so a container built from a clean checkout has no copy of them.
`START.bat` downloads them locally; this does the same thing for a hosted
container, once, at startup.

Downloads are written to a temporary file and renamed into place, so an
interrupted transfer can never leave a truncated model that OpenCV would fail
to parse on the next boot.
"""

from __future__ import annotations

import shutil
import subprocess
import urllib.request
from pathlib import Path

import config as cfg

# A modern user agent: some CDNs serve an HTML error page to the default
# urllib agent, which would be written to disk as a corrupt "model".
_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# ONNX files begin with a protobuf field header; HTML error pages do not.
_MIN_BYTES = 100_000


def _fetch(url: str) -> bytes:
    """Fetch a URL, preferring curl.

    Python's urllib uses the OS certificate store, which fails behind a
    TLS-inspecting proxy. curl ships its own CA bundle. Verification stays
    enabled in both paths - the fallback is a different trust store, not a
    weaker check.
    """
    curl = shutil.which("curl")
    if curl:
        result = subprocess.run(
            [curl, "-sSL", "--fail", "-A", _UA, url],
            capture_output=True, timeout=300,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout

    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=300) as response:
        return response.read()


def ensure_face_models() -> list[str]:
    """Download any missing face model. Returns the names actually fetched."""
    if not cfg.AUTO_DOWNLOAD_FACE_MODELS:
        return []

    fetched: list[str] = []

    for name, url in cfg.FACE_MODEL_URLS.items():
        dest = cfg.MODELS_DIR / name
        if dest.exists() and dest.stat().st_size > _MIN_BYTES:
            continue

        try:
            payload = _fetch(url)
        except Exception as exc:                           # noqa: BLE001
            print(f"  ! could not download {name}: {type(exc).__name__}: {exc}")
            continue

        if len(payload) < _MIN_BYTES:
            print(f"  ! {name} download looked wrong ({len(payload)} bytes) - discarded")
            continue

        # Write then rename: a partial file must never be left at the real path.
        staging = dest.with_suffix(dest.suffix + ".partial")
        staging.write_bytes(payload)
        staging.replace(dest)

        fetched.append(name)
        print(f"  + downloaded {name} ({len(payload) / 1e6:.1f} MB)")

    return fetched


def describe_environment() -> str:
    """One line summarising where this instance keeps its state."""
    return (f"data={cfg.DATA_DIR}  cross_site_cookies={cfg.CROSS_SITE_COOKIES}  "
            f"extra_origins={len(cfg.ALLOWED_ORIGINS) - 4}")
