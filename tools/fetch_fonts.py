"""Self-hosts the project's web fonts.

Downloads the latin subset of Space Grotesk and Inter from Google Fonts into
`frontend/public/fonts/` and writes the matching @font-face rules.

Self-hosting is not a preference here - it is a demo-safety requirement. A
dashboard that pulls fonts from fonts.gstatic.com falls back to Times New Roman
the moment venue wifi drops, which is exactly when you are standing in front of
judges. Everything the app needs ships inside the repo.

    python tools/fetch_fonts.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
FONT_DIR = PROJECT / "frontend" / "public" / "fonts"
SCSS_OUT = PROJECT / "frontend" / "src" / "styles" / "_fonts.scss"

GOOGLE_CSS = (
    "https://fonts.googleapis.com/css2"
    "?family=Space+Grotesk:wght@500;600;700"
    "&family=Inter:wght@400;500;600;700"
    "&display=swap"
)

# A modern UA is required or Google serves legacy ttf instead of woff2.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Only the latin subset. The others (cyrillic, greek, vietnamese) would roughly
# quadruple the payload for characters this interface never renders.
WANTED_SUBSET = "latin"


def fetch(url: str) -> bytes:
    """Fetch a URL, preferring curl.

    Python's urllib uses the OS certificate store, which fails on machines
    behind a TLS-inspecting proxy or antivirus ("Basic Constraints of CA cert
    not marked critical"). curl ships its own CA bundle and succeeds there.
    Certificate verification stays ON in both paths - the fallback is a
    different trust store, not a weaker check.
    """
    curl = shutil.which("curl")
    if curl:
        result = subprocess.run(
            [curl, "-sSL", "--fail", "-A", UA, url],
            capture_output=True, timeout=120,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout
        print(f"  curl failed ({result.returncode}), falling back to urllib",
              file=sys.stderr)

    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    SCSS_OUT.parent.mkdir(parents=True, exist_ok=True)

    print("fetching font CSS from Google Fonts ...")
    css = fetch(GOOGLE_CSS).decode("utf-8")

    # Each @font-face is preceded by a /* subset */ comment.
    blocks = re.findall(r"/\*\s*([a-z-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", css)
    if not blocks:
        print("Could not parse the Google Fonts response.", file=sys.stderr)
        return 1

    rules, seen = [], set()

    for subset, block in blocks:
        if subset != WANTED_SUBSET:
            continue

        family = re.search(r"font-family:\s*'([^']+)'", block)
        weight = re.search(r"font-weight:\s*(\d+)", block)
        style = re.search(r"font-style:\s*(\w+)", block)
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block)
        unicode_range = re.search(r"unicode-range:\s*([^;]+);", block)
        if not (family and weight and url):
            continue

        slug = f"{family.group(1).replace(' ', '')}-{weight.group(1)}.woff2"
        if slug in seen:
            continue
        seen.add(slug)

        dest = FONT_DIR / slug
        if not dest.exists():
            data = fetch(url.group(1))
            dest.write_bytes(data)
            print(f"  downloaded {slug:<28} {len(data) / 1024:6.1f} KB")
        else:
            print(f"  cached     {slug}")

        rules.append(
            "@font-face {\n"
            f"  font-family: '{family.group(1)}';\n"
            f"  font-style: {style.group(1) if style else 'normal'};\n"
            f"  font-weight: {weight.group(1)};\n"
            "  font-display: swap;\n"
            f"  src: url('/fonts/{slug}') format('woff2');\n"
            + (f"  unicode-range: {unicode_range.group(1)};\n" if unicode_range else "")
            + "}"
        )

    if not rules:
        print("No latin subset found in the response.", file=sys.stderr)
        return 1

    header = (
        "// GENERATED FILE - do not edit by hand.\n"
        "// Regenerate with:  python tools/fetch_fonts.py\n"
        "//\n"
        "// Fonts are self-hosted from frontend/public/fonts so the dashboard\n"
        "// renders correctly with no internet connection.\n"
        "// Space Grotesk and Inter are both licensed under the SIL Open Font License.\n\n"
    )
    SCSS_OUT.write_text(header + "\n\n".join(rules) + "\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in FONT_DIR.glob("*.woff2")) / 1024
    print(f"\nwrote {SCSS_OUT.relative_to(PROJECT)}  ({len(rules)} faces, {total:.0f} KB total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
