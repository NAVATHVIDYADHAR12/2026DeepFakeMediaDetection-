"""Tests for the in-app assistant.

The assistant is a retrieval system, so the thing worth testing is that it
routes questions to the right knowledge entry, quotes real live data, and
declines rather than guesses when it doesn't know.
"""

from __future__ import annotations

import pytest

import assistant
import database as db


class TestIntentRouting:
    @pytest.mark.parametrize("question,expected", [
        ("how does it work?", "how_it_works"),
        ("what is the heatmap showing me", "heatmap"),
        ("what is ELA?", "ela"),
        ("explain c2pa", "c2pa"),
        ("what does ROC-AUC mean", "metrics"),
        ("how are the thresholds set", "thresholds"),
        ("how does video tracking work", "video"),
        ("how does face recognition work", "face_recognition"),
        ("how do I train the models", "training"),
        ("what dataset was used", "dataset"),
        ("can I trust this verdict?", "limitations"),
        ("is my data stored anywhere", "privacy"),
        ("what formats can I upload", "formats"),
        ("why is there no audio detection", "audio"),
        ("how can I improve accuracy", "improve"),
        ("what is a deepfake", "what_is_deepfake"),
        ("what can you do", "help"),
    ])
    def test_routes_to_expected_intent(self, question, expected):
        assert assistant.ask(question)["intent"] == expected

    def test_unknown_question_declines(self):
        result = assistant.ask("what is the capital of France")
        assert result["intent"] is None
        assert "curated knowledge base" in result["answer"]

    def test_empty_question_declines(self):
        assert assistant.ask("")["intent"] is None
        assert assistant.ask("   ")["intent"] is None

    def test_declining_still_offers_suggestions(self):
        assert len(assistant.ask("xyzzy plugh")["followups"]) >= 3

    def test_single_stopword_does_not_trigger_an_answer(self):
        # "the" alone must not score its way into an intent
        assert assistant.ask("the")["intent"] is None

    def test_confidence_is_bounded(self):
        for q in ("how does it work", "asdfgh", "what is the heatmap"):
            assert 0.0 <= assistant.ask(q)["confidence"] <= 1.0


class TestAnswerQuality:
    def test_every_entry_has_required_fields(self):
        for entry in assistant.KNOWLEDGE:
            assert entry["id"]
            assert entry.get("keywords") or entry.get("phrases")
            assert entry["answer"]

    def test_intent_ids_are_unique(self):
        ids = [e["id"] for e in assistant.KNOWLEDGE]
        assert len(ids) == len(set(ids))

    def test_static_answers_are_substantial(self):
        for entry in assistant.KNOWLEDGE:
            if isinstance(entry["answer"], str):
                assert len(entry["answer"]) > 120, f"{entry['id']} answer is thin"

    def test_thresholds_answer_reflects_actual_config(self):
        import config as cfg
        answer = assistant.ask("what is the threshold")["answer"]
        assert f"{cfg.FAKE_THRESHOLD:.0%}" in answer

    def test_limitations_answer_is_honest(self):
        answer = assistant.ask("can I trust the verdict").lower() if False else \
            assistant.ask("can I trust the verdict")["answer"].lower()
        assert "evidence, not proof" in answer


class TestLiveData:
    def test_last_scan_with_empty_database(self):
        answer = assistant.ask("what was my last scan")["answer"]
        assert "haven't scanned anything yet" in answer

    def test_last_scan_quotes_the_real_record(self):
        db.save_scan({
            "scan_id": "SCN_AI_1", "media_type": "image", "filename": "evidence.jpg",
            "verdict": "FAKE", "risk_level": "HIGH", "fake_probability": 0.91,
            "authenticity_score": 9.0, "confidence": 0.82, "faces_detected": 2,
            "file_size_bytes": 4096, "processing_ms": 180.0, "faces": [],
        })
        answer = assistant.ask("what does my last scan mean")["answer"]
        assert "evidence.jpg" in answer
        assert "91.0%" in answer
        assert "Fake" in answer

    def test_stats_answer_uses_real_counts(self):
        for i, verdict in enumerate(["FAKE", "AUTHENTIC", "AUTHENTIC"]):
            db.save_scan({
                "scan_id": f"SCN_AI_S{i}", "media_type": "image", "filename": f"{i}.jpg",
                "verdict": verdict, "risk_level": "LOW", "fake_probability": 0.5,
                "authenticity_score": 50.0, "confidence": 0.1, "faces_detected": 1,
                "file_size_bytes": 10, "processing_ms": 5.0, "faces": [],
            })
        answer = assistant.ask("how many scans have I done")["answer"]
        assert "3 file(s)" in answer

    def test_stats_answer_on_empty_database(self):
        assert "No scans recorded yet" in assistant.ask("how many scans")["answer"]

    def test_models_answer_without_models(self):
        answer = assistant.ask("how accurate are the models", {"ready": False})["answer"]
        assert "No trained models" in answer

    def test_models_answer_flags_placeholder(self):
        info = {"ready": True, "models": [{"name": "Placeholder", "metrics": {}}],
                "ensemble_metrics": {}}
        assert "meaningless" in assistant.ask("model accuracy", info)["answer"]

    def test_models_answer_reports_real_metrics(self):
        info = {
            "ready": True,
            "models": [{"name": "EfficientNet-B0",
                        "metrics": {"accuracy": 0.9421, "roc_auc": 0.981}}],
            "ensemble_metrics": {"accuracy": 0.9563, "roc_auc": 0.9885},
        }
        answer = assistant.ask("how accurate are the models", info)["answer"]
        assert "94.2%" in answer
        assert "95.6%" in answer


class TestApiEndpoint:
    def test_assistant_endpoint(self, client_for_assistant):
        r = client_for_assistant.post("/api/assistant", data={"question": "how does it work"})
        assert r.status_code == 200
        body = r.json()
        assert body["intent"] == "how_it_works"
        assert len(body["answer"]) > 100
        assert isinstance(body["followups"], list)

    def test_assistant_endpoint_handles_nonsense(self, client_for_assistant):
        body = client_for_assistant.post("/api/assistant",
                                         data={"question": "qwertyuiop"}).json()
        assert body["intent"] is None

    def test_suggestions_endpoint(self, client_for_assistant):
        r = client_for_assistant.get("/api/assistant/suggestions")
        assert r.status_code == 200
        assert len(r.json()["suggestions"]) >= 3


@pytest.fixture(scope="module")
def client_for_assistant():
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app) as c:
        yield c
