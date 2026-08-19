"""Tests for plagiarism overlap and AI-text indicators.

The two checks are held to different standards on purpose. Plagiarism overlap
is an exact measurement, so it is asserted exactly: copied text must score
100%, unrelated text 0%. The AI indicators are heuristics, so they are asserted
only on *ordering* and on the properties that must always hold - never on a
specific score, which would pin the tests to today's arbitrary weights.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
import textcheck


HUMAN = (
    "The rain started just after four. I had not brought a coat, which was "
    "stupid, because the forecast had been clear about it all week. So I stood "
    "under the awning outside the chemist and waited. A man beside me was "
    "eating chips. He offered me one. I said no, then changed my mind. They "
    "were very good chips. We did not speak again. When the rain eased I "
    "walked home the long way, past the canal, where someone had left a "
    "bicycle in the water. Only the handlebars showed."
)

LLM = (
    "In today's world, it is important to note that technology plays a crucial "
    "role in shaping our society. Furthermore, the ever-evolving landscape of "
    "digital innovation underscores the importance of adaptation. Moreover, "
    "organisations must navigate the complexities of this multifaceted "
    "environment. It is worth noting that the rich tapestry of modern "
    "communication paves the way for unprecedented opportunities. In "
    "conclusion, the significance of these developments cannot be overstated "
    "when it comes to future growth in the realm of business."
)


# ------------------------------------------------------------------ plagiarism
class TestPlagiarism:
    def test_verbatim_copy_scores_full_overlap(self):
        excerpt = "So I stood under the awning outside the chemist and waited."
        r = textcheck.check_plagiarism(excerpt, HUMAN)
        assert r["available"] is True
        assert r["overlap_percent"] == 100.0
        assert r["verdict"] == "HIGH"

    def test_unrelated_text_scores_zero(self):
        other = ("Orbital mechanics governs the transfer window between two "
                 "planetary bodies under gravitational influence.")
        r = textcheck.check_plagiarism(other, HUMAN)
        assert r["overlap_percent"] == 0.0
        assert r["verdict"] == "MINIMAL"
        assert r["matched_spans"] == []

    def test_partial_copy_scores_between(self):
        mixed = ("My own introduction that nobody else wrote. "
                 "So I stood under the awning outside the chemist and waited. "
                 "A completely different closing sentence of my own.")
        r = textcheck.check_plagiarism(mixed, HUMAN)
        assert 0 < r["overlap_percent"] < 100
        assert len(r["matched_spans"]) == 1

    def test_spans_index_the_original_text_exactly(self):
        """The UI slices the submitted string with these offsets, so a
        mismatch would highlight the wrong words."""
        mixed = ("Something original first. "
                 "So I stood under the awning outside the chemist and waited. "
                 "Something original last.")
        r = textcheck.check_plagiarism(mixed, HUMAN)
        for span in r["matched_spans"]:
            assert mixed[span["start"]:span["end"]] == span["text"]

    def test_spans_are_ordered_and_disjoint(self):
        mixed = HUMAN[:200] + " Entirely unrelated filler. " + HUMAN[200:]
        r = textcheck.check_plagiarism(mixed, HUMAN)
        spans = r["matched_spans"]
        for a, b in zip(spans, spans[1:]):
            assert a["end"] <= b["start"], "spans overlap or are unsorted"

    def test_flagged_word_count_matches_spans(self):
        mixed = ("Original opening. "
                 "So I stood under the awning outside the chemist and waited. "
                 "Original ending.")
        r = textcheck.check_plagiarism(mixed, HUMAN)
        assert r["flagged_words"] == sum(s["words"] for s in r["matched_spans"])
        assert r["flagged_words"] <= r["total_words"]

    def test_missing_reference_is_refused_not_guessed(self):
        r = textcheck.check_plagiarism(HUMAN, "")
        assert r["available"] is False
        assert "reference" in r["reason"].lower()

    def test_note_does_not_claim_to_search_the_web(self):
        r = textcheck.check_plagiarism("So I stood under the awning outside", HUMAN)
        assert "does not search the internet" in r["note"]

    def test_case_and_punctuation_are_ignored_when_matching(self):
        shouted = "SO I STOOD UNDER THE AWNING, OUTSIDE THE CHEMIST!! AND WAITED"
        r = textcheck.check_plagiarism(shouted, HUMAN)
        assert r["overlap_percent"] > 50


# ------------------------------------------------------------------- AI text
class TestAiIndicators:
    def test_llm_prose_scores_above_human_prose(self):
        """The only ordering claim worth making. Absolute values are not
        asserted - they would pin the test to today's weights."""
        human = textcheck.check_ai_text(HUMAN)["ai_likelihood_percent"]
        llm = textcheck.check_ai_text(LLM)["ai_likelihood_percent"]
        assert llm > human

    def test_short_text_is_refused_rather_than_scored(self):
        r = textcheck.check_ai_text("Too short to say anything about.")
        assert r["available"] is False
        assert str(textcheck.MIN_WORDS) in r["reason"]

    def test_score_is_a_percentage(self):
        r = textcheck.check_ai_text(LLM)
        assert 0.0 <= r["ai_likelihood_percent"] <= 100.0

    def test_every_signal_is_reported_with_its_weight(self):
        r = textcheck.check_ai_text(LLM)
        assert len(r["signals"]) == 6
        for s in r["signals"]:
            assert 0 <= s["strength"] <= 100
            assert s["detail"] and s["meaning"]
        assert sum(s["weight"] for s in r["signals"]) == 100

    def test_confidence_is_declared_low(self):
        """A high-confidence claim here would be dishonest; the module is
        explicit that these are indicators, not detection."""
        assert textcheck.check_ai_text(LLM)["confidence"] == "low"

    def test_note_warns_against_treating_it_as_proof(self):
        note = textcheck.check_ai_text(LLM)["note"].lower()
        assert "not a detector" in note
        assert "never" in note

    def test_model_phrasing_is_detected(self):
        signals = {s["name"]: s for s in textcheck.check_ai_text(LLM)["signals"]}
        assert signals["Model-typical phrasing"]["strength"] > 0

    def test_human_prose_does_not_trigger_phrase_signal(self):
        signals = {s["name"]: s for s in textcheck.check_ai_text(HUMAN)["signals"]}
        assert signals["Model-typical phrasing"]["strength"] == 0


class TestAiRegions:
    def test_llm_passage_is_flagged_and_human_passage_is_not(self):
        mixed = (
            "I walked to the shop. It was cold. The bread had run out again. "
            "In today's world, it is important to note that technology plays a "
            "crucial role in shaping our society and underscores the importance "
            "of adaptation across the multifaceted landscape. "
            "So I bought milk instead."
        )
        r = textcheck.check_ai_text(mixed)
        assert r["flagged_sentences"], "the LLM-style sentence should be flagged"

        flagged_text = " ".join(
            mixed[s["start"]:s["end"]] for s in r["flagged_sentences"]
        )
        assert "in today's world" in flagged_text.lower()
        assert "bought milk" not in flagged_text.lower()

    def test_regions_index_the_original_text_exactly(self):
        r = textcheck.check_ai_text(LLM)
        for s in r["flagged_sentences"]:
            assert LLM[s["start"]:s["end"]].strip() == LLM[s["start"]:s["end"]]
            assert s["end"] > s["start"]

    def test_every_region_states_why(self):
        r = textcheck.check_ai_text(LLM)
        for s in r["flagged_sentences"]:
            assert s["reasons"], "a flagged passage with no stated reason is not usable"
            assert 0 < s["strength"] <= 100

    def test_regions_are_ordered_and_disjoint(self):
        r = textcheck.check_ai_text(LLM)
        spans = r["flagged_sentences"]
        for a, b in zip(spans, spans[1:]):
            assert a["end"] <= b["start"]

    def test_human_prose_flags_little_or_nothing(self):
        r = textcheck.check_ai_text(HUMAN)
        assert r["flagged_word_count"] <= r["total_word_count"] * 0.35


# ------------------------------------------------------------------ dispatch
class TestAnalyze:
    def test_runs_only_what_was_requested(self):
        only_ai = textcheck.analyze(LLM, "", want_plagiarism=False, want_ai=True)
        assert only_ai["checks_run"] == ["ai_text"]
        assert "plagiarism" not in only_ai

        only_plag = textcheck.analyze(LLM, HUMAN, want_plagiarism=True, want_ai=False)
        assert only_plag["checks_run"] == ["plagiarism"]
        assert "ai_text" not in only_plag

    def test_empty_text_is_rejected(self):
        with pytest.raises(ValueError):
            textcheck.analyze("   ", HUMAN)

    def test_no_checks_selected_is_rejected(self):
        with pytest.raises(ValueError):
            textcheck.analyze(LLM, HUMAN, want_plagiarism=False, want_ai=False)

    def test_large_document_stays_fast(self):
        """Guards against an accidental quadratic: document shingles are
        counted once and reused per sentence."""
        import time
        big = (HUMAN + " " + LLM) * 120
        start = time.perf_counter()
        textcheck.analyze(big, HUMAN * 40)
        elapsed = time.perf_counter() - start
        words = len(big.split())
        assert elapsed < 5.0, f"{words:,} words took {elapsed:.1f}s"


# ----------------------------------------------------------------- endpoint
class TestTextEndpoint:
    @pytest.fixture
    def client(self):
        with TestClient(main.app) as c:
            yield c

    def test_both_checks_over_http(self, client):
        r = client.post("/api/text/analyze", data={
            "text": LLM, "reference": HUMAN,
            "check_plagiarism": "true", "check_ai": "true",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "plagiarism" in body and "ai_text" in body
        assert body["word_count"] > 0

    def test_empty_text_returns_422(self, client):
        r = client.post("/api/text/analyze", data={"text": "  "})
        assert r.status_code == 422

    def test_oversized_text_is_refused(self, client):
        r = client.post("/api/text/analyze", data={"text": "word " * 60_000})
        assert r.status_code == 413

    def test_selecting_neither_check_returns_422(self, client):
        r = client.post("/api/text/analyze", data={
            "text": LLM, "check_plagiarism": "false", "check_ai": "false",
        })
        assert r.status_code == 422
