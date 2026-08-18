"""Text analysis: plagiarism overlap and AI-generation indicators.

Two very different problems, deliberately kept apart because their evidence is
of completely different quality:

* **Plagiarism** is *measurable*. Given a reference text, the shared-n-gram
  overlap between two documents is an exact quantity, and the matching passages
  can be pointed at. The percentage means something precise.

* **AI-generated text** is *not* reliably measurable. There is no signal that
  separates machine from human prose the way a face-swap artefact separates a
  forgery from a photograph. What is computable is a set of stylistic
  statistics that skew differently on average - sentence-length variance,
  vocabulary diversity, repetition, and phrasing that current models overuse.
  Those are indicators, not proof, and the output says so.

The honest framing matters here: published AI-text detectors routinely
misclassify human writing, and the consequences (accusing a student of
cheating) are serious. This module reports the individual signals alongside the
score so a reader can judge them, and it never returns a bare verdict.
"""

from __future__ import annotations

import math
import re
from collections import Counter

# --------------------------------------------------------------------- tuning
MIN_WORDS = 40           # below this, every statistic is noise
NGRAM = 5                # shingle size for overlap; long enough that a match
                         # is unlikely to be coincidental

# Phrases current large language models produce far more often than people do.
# Presence is weak evidence on its own, which is why it is one signal of six.
LLM_PHRASES = (
    "delve into", "it is important to note", "it's important to note",
    "in conclusion", "furthermore", "moreover", "in today's world",
    "navigate the complexities", "rich tapestry", "a testament to",
    "plays a crucial role", "it is worth noting", "in the realm of",
    "underscores the importance", "multifaceted", "ever-evolving",
    "shed light on", "at the end of the day", "when it comes to",
    "the landscape of", "paves the way", "cannot be overstated",
)

_WORD = re.compile(r"[a-z0-9']+")
_SENTENCE = re.compile(r"[^.!?]+[.!?]*")


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE.findall(text) if s.strip()]


def _shingles(words: list[str], n: int = NGRAM) -> list[tuple[str, ...]]:
    return [tuple(words[i:i + n]) for i in range(max(0, len(words) - n + 1))]


# ----------------------------------------------------------------- plagiarism
def check_plagiarism(text: str, reference: str) -> dict:
    """Exact n-gram overlap between a document and a reference.

    Uses word 5-grams: long enough that a shared run is very unlikely to be
    coincidental, short enough to survive light paraphrasing of the
    surrounding sentence.

    The percentage is the share of the submitted text's 5-grams that also
    appear in the reference - a real measurement, not an estimate.
    """
    words = _words(text)
    ref_words = _words(reference or "")

    if len(words) < NGRAM:
        return {
            "available": False,
            "reason": f"Need at least {NGRAM} words to compare.",
        }
    if len(ref_words) < NGRAM:
        return {
            "available": False,
            "reason": "Paste a reference text to compare against. Without one there is "
                      "nothing to measure overlap with - this compares two documents, it "
                      "does not search the web.",
        }

    doc = _shingles(words)
    ref = set(_shingles(ref_words))

    matched_flags = [s in ref for s in doc]
    matched = sum(matched_flags)
    overlap = matched / len(doc) if doc else 0.0

    # Which word positions fall inside a matching run. A shingle at index i
    # covers words i..i+NGRAM-1, so a hit marks all of them.
    flagged = [False] * len(words)
    for i, hit in enumerate(matched_flags):
        if hit:
            for j in range(i, min(i + NGRAM, len(words))):
                flagged[j] = True

    # Character offsets into the ORIGINAL text, so the UI can highlight the
    # passage in place rather than showing a reconstructed lowercase copy.
    # Walking the original with the same tokenizer keeps the two in step.
    spans: list[dict] = []
    positions = [(m.start(), m.end()) for m in _WORD.finditer(text.lower())]

    run_start = None
    for i in range(len(words) + 1):
        inside = i < len(words) and flagged[i]
        if inside and run_start is None:
            run_start = i
        elif not inside and run_start is not None:
            start_char = positions[run_start][0]
            end_char = positions[i - 1][1]
            spans.append({
                "start": start_char,
                "end": end_char,
                "words": i - run_start,
                "text": text[start_char:end_char],
            })
            run_start = None

    passages = sorted((s["text"] for s in spans), key=len, reverse=True)

    return {
        "available": True,
        "overlap_percent": round(overlap * 100, 1),
        "matched_ngrams": matched,
        "total_ngrams": len(doc),
        "ngram_size": NGRAM,
        "matched_passages": passages[:12],
        # Character ranges, in document order, for inline highlighting.
        "matched_spans": sorted(spans, key=lambda s: s["start"]),
        "flagged_words": sum(flagged),
        "total_words": len(words),
        "longest_match_words": max((s["words"] for s in spans), default=0),
        "verdict": (
            "HIGH" if overlap >= 0.25 else
            "MODERATE" if overlap >= 0.10 else
            "LOW" if overlap >= 0.03 else
            "MINIMAL"
        ),
        "note": (
            "Share of this text's 5-word sequences that also appear in the reference. "
            "This is an exact measurement against the text you provided; it does not "
            "search the internet."
        ),
    }


# ------------------------------------------------------------- AI indicators
def _burstiness(sentences: list[str]) -> float:
    """Coefficient of variation of sentence length.

    Human prose mixes long and short sentences; generated prose tends toward a
    uniform rhythm. Higher means more human-like variation.
    """
    lengths = [len(_words(s)) for s in sentences if _words(s)]
    if len(lengths) < 3:
        return 0.0
    mean = sum(lengths) / len(lengths)
    if mean == 0:
        return 0.0
    var = sum((x - mean) ** 2 for x in lengths) / len(lengths)
    return math.sqrt(var) / mean


def check_ai_text(text: str) -> dict:
    """Stylistic indicators associated with machine-generated prose.

    Deliberately returns the component signals as well as a combined score.
    None of these is decisive, and the combination is not a detector - it is a
    summary of how the writing compares to typical human prose on measurable
    axes.
    """
    words = _words(text)
    sentences = _sentences(text)

    if len(words) < MIN_WORDS:
        return {
            "available": False,
            "reason": f"Need at least {MIN_WORDS} words; got {len(words)}. "
                      f"Short samples cannot support any of these statistics.",
        }

    lowered = text.lower()

    # 1. Burstiness - low variation leans machine.
    burst = _burstiness(sentences)
    burst_signal = max(0.0, min(1.0, (0.55 - burst) / 0.45))

    # 2. Vocabulary diversity, length-normalised so long texts are not punished.
    unique = len(set(words))
    ttr = unique / len(words)
    expected_ttr = max(0.28, 0.85 - 0.06 * math.log(max(len(words), 2)))
    diversity_signal = max(0.0, min(1.0, (expected_ttr - ttr) / max(expected_ttr, 1e-6)))

    # 3. Repeated 5-grams within the text itself.
    shingles = _shingles(words)
    repeats = sum(c - 1 for c in Counter(shingles).values() if c > 1)
    repeat_ratio = repeats / len(shingles) if shingles else 0.0
    repeat_signal = min(1.0, repeat_ratio * 12)

    # 4. Phrases current models overuse.
    found_phrases = [p for p in LLM_PHRASES if p in lowered]
    phrase_signal = min(1.0, len(found_phrases) / 4)

    # 5. Sentence-length uniformity in absolute terms.
    lengths = [len(_words(s)) for s in sentences if _words(s)]
    avg_len = sum(lengths) / len(lengths) if lengths else 0
    uniform_signal = max(0.0, min(1.0, (avg_len - 14) / 16)) if avg_len else 0.0

    # 6. Punctuation variety - generated prose leans on commas and full stops.
    marks = Counter(c for c in text if c in ",;:-()\"'?!")
    variety = len(marks) / 10
    punct_signal = max(0.0, min(1.0, 1 - variety))

    signals = [
        ("Sentence-length variation", burst_signal, 0.28,
         f"coefficient of variation {burst:.2f}",
         "Human writing mixes long and short sentences more than generated text."),
        ("Vocabulary diversity", diversity_signal, 0.20,
         f"{unique} unique of {len(words)} words ({ttr:.2f})",
         "Lower-than-expected diversity for this length."),
        ("Internal repetition", repeat_signal, 0.16,
         f"{repeats} repeated 5-grams",
         "Repeated phrasing within the same passage."),
        ("Model-typical phrasing", phrase_signal, 0.16,
         ", ".join(found_phrases[:5]) if found_phrases else "none found",
         "Phrases current language models overuse."),
        ("Sentence length", uniform_signal, 0.10,
         f"{avg_len:.1f} words average",
         "Consistently long sentences are more common in generated prose."),
        ("Punctuation variety", punct_signal, 0.10,
         f"{len(marks)} distinct marks",
         "Narrow punctuation range."),
    ]

    score = sum(value * weight for _, value, weight, _, _ in signals)

    return {
        "available": True,
        "ai_likelihood_percent": round(score * 100, 1),
        "confidence": "low",          # deliberate: see the module docstring
        "verdict": (
            "STRONG INDICATORS" if score >= 0.65 else
            "SOME INDICATORS" if score >= 0.45 else
            "FEW INDICATORS" if score >= 0.25 else
            "MINIMAL INDICATORS"
        ),
        "word_count": len(words),
        "sentence_count": len(sentences),
        "signals": [
            {
                "name": name,
                "strength": round(value * 100, 1),
                "weight": round(weight * 100),
                "detail": detail,
                "meaning": meaning,
            }
            for name, value, weight, detail, meaning in signals
        ],
        "note": (
            "These are stylistic statistics, not a detector. Published AI-text "
            "detectors misclassify human writing regularly, and no signal here is "
            "decisive. Treat a high score as a reason to look closer - never as "
            "evidence on its own."
        ),
    }


def analyze(text: str, reference: str = "", want_plagiarism: bool = True,
            want_ai: bool = True) -> dict:
    """Run whichever checks were requested."""
    text = (text or "").strip()
    if not text:
        raise ValueError("No text provided.")

    result: dict = {
        "word_count": len(_words(text)),
        "character_count": len(text),
        "sentence_count": len(_sentences(text)),
        "checks_run": [],
    }

    if want_plagiarism:
        result["plagiarism"] = check_plagiarism(text, reference)
        result["checks_run"].append("plagiarism")
    if want_ai:
        result["ai_text"] = check_ai_text(text)
        result["checks_run"].append("ai_text")

    if not result["checks_run"]:
        raise ValueError("Select at least one check.")

    return result
