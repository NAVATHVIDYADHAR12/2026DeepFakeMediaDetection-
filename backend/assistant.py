"""OmniGuard Assistant - the in-app help chat.

This is a **retrieval assistant, not a language model**. It scores the question
against a curated knowledge base and answers from it, and it can read the live
database so questions like "how many fakes have I found?" get real numbers
rather than invented ones.

That design is deliberate. A generative model would need an API key, a network
round trip and money per message, and it could hallucinate claims about how this
system works. A curated base cannot: every answer here is one somebody wrote and
can defend. The trade-off is that it only knows what it was taught, so it says
so plainly when a question falls outside that.
"""

from __future__ import annotations

import re

import config as cfg
import database as db

# Words too common to carry meaning in scoring.
_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "of",
    "to", "in", "on", "at", "for", "with", "and", "or", "but", "if", "then",
    "this", "that", "these", "those", "it", "its", "i", "you", "me", "my",
    "your", "do", "does", "did", "can", "could", "would", "should", "will",
    "what", "how", "why", "when", "where", "which", "who", "am", "so", "about",
    "please", "tell", "explain", "mean", "means", "some", "any", "just", "get",
}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOPWORDS}


def _token_list(text: str) -> list[str]:
    """Stopwords removed, order kept."""
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOPWORDS]


def _contains_run(haystack: list[str], needle: list[str]) -> bool:
    """True if `needle` appears as a contiguous run of whole tokens.

    Deliberately not a substring test on the joined strings: that made "scan"
    match inside "scans" and mis-routed questions to the wrong intent.
    """
    if not needle or len(needle) > len(haystack):
        return False
    return any(haystack[i:i + len(needle)] == needle
               for i in range(len(haystack) - len(needle) + 1))


# ---------------------------------------------------------------------------
# Knowledge base.
#
# `phrases`   - multi-word; 2.5 on an exact hit, 2.0 stopword-insensitive
# `strong`    - single terms distinctive enough to decide alone (2.0 each)
# `keywords`  - ordinary terms, 1.0 each
# `answer`    - str, or a callable receiving live context
# `followups` - suggestion chips rendered under the reply
# ---------------------------------------------------------------------------

def _answer_last_scan(ctx: dict) -> str:
    scan = ctx.get("last_scan")
    if not scan:
        return ("You haven't scanned anything yet. Drop an image or video on the "
                "Media Scanner and I'll walk you through the result.")

    verdict = scan["verdict"]
    prob = scan["fake_probability"] * 100
    reading = {
        "AUTHENTIC": (f"It came back **Authentic**. The model ensemble put the probability of "
                      f"manipulation at {prob:.1f}%, below the {cfg.SUSPICIOUS_THRESHOLD:.0%} "
                      f"suspicion threshold."),
        "SUSPICIOUS": (f"It came back **Suspicious** — {prob:.1f}% probability of manipulation. "
                       f"That sits between the two thresholds: enough to warrant a second look, "
                       f"not enough to call it fake."),
        "FAKE": (f"It came back **Fake / Manipulated**, at {prob:.1f}% probability — above the "
                 f"{cfg.FAKE_THRESHOLD:.0%} threshold."),
    }.get(verdict, f"The verdict was {verdict} at {prob:.1f}%.")

    return (f"Your most recent scan was **{scan['filename']}**.\n\n{reading}\n\n"
            f"Authenticity score {scan['authenticity_score']}%, "
            f"{scan.get('faces_detected', 0)} face(s) analysed, "
            f"processed in {scan.get('processing_ms', 0):.0f} ms. "
            f"Open the full report to see the heatmap showing which pixels drove that call.")


def _answer_stats(ctx: dict) -> str:
    s = ctx["stats"]
    if s["total_scans"] == 0:
        return "No scans recorded yet — the counters are all at zero."
    return (f"So far this instance has analysed **{s['total_scans']} file(s)**:\n\n"
            f"- Authentic: {s['authentic']} ({s['authentic_pct']}%)\n"
            f"- Suspicious: {s['suspicious']} ({s['suspicious_pct']}%)\n"
            f"- Fake / Manipulated: {s['fake']} ({s['fake_pct']}%)\n\n"
            f"Average processing time is {s['avg_processing_ms']:.0f} ms per file.")


def _answer_models(ctx: dict) -> str:
    info = ctx.get("detector", {})
    if not info.get("ready"):
        return ("No trained models are loaded right now, so detection is disabled. "
                "Run `notebooks/OmniGuard_Training.ipynb` on Google Colab with a T4 GPU, "
                "then unzip the result into `backend/models/` and restart.")

    lines = []
    for m in info.get("models", []):
        acc = m.get("metrics", {}).get("accuracy")
        auc = m.get("metrics", {}).get("roc_auc")
        if acc is None:
            lines.append(f"- **{m['name']}** — no metrics recorded "
                         f"(this is the untrained placeholder; its output is meaningless)")
        else:
            lines.append(f"- **{m['name']}** — {acc * 100:.1f}% accuracy, {auc:.3f} ROC-AUC")

    ens = info.get("ensemble_metrics") or {}
    tail = ""
    if ens.get("accuracy"):
        tail = (f"\n\nCombined as an ensemble they reach **{ens['accuracy'] * 100:.1f}% accuracy** "
                f"({ens['roc_auc']:.3f} AUC) — averaging the votes beats any single model, because "
                f"the architectures fail on different images.")

    return (f"{len(info.get('models', []))} model(s) are loaded:\n\n" + "\n".join(lines) + tail +
            "\n\nAll figures come from a held-out test set the models never saw during training.")


KNOWLEDGE = [
    # ---------------------------------------------------------------- live data
    {
        "id": "last_scan",
        "phrases": ["last scan", "recent scan", "my scan", "latest scan", "my result",
                    "previous scan", "that scan", "my last"],
        "keywords": ["last", "recent", "latest", "result", "verdict"],
        "answer": _answer_last_scan,
        "followups": ["What does the heatmap show?", "Can I trust this verdict?"],
    },
    {
        "id": "stats",
        "phrases": ["how many scans", "how many fakes", "how many files", "statistics",
                    "my stats", "total scans", "how many have"],
        "keywords": ["many", "count", "total", "statistics", "stats", "number"],
        "answer": _answer_stats,
        "followups": ["Show me my last scan", "How accurate are the models?"],
    },
    {
        "id": "models",
        "phrases": ["how accurate", "model accuracy", "which models", "what models",
                    "how good is", "accuracy of", "model performance"],
        "keywords": ["accurate", "accuracy", "models", "model", "performance", "efficientnet",
                     "xception", "mobilenet", "ensemble"],
        "answer": _answer_models,
        "followups": ["What does ROC-AUC mean?", "What were the models trained on?"],
    },

    # ------------------------------------------------------------------ concepts
    {
        "id": "what_is_deepfake",
        "strong": ['deepfake', 'deepfakes'],
        "phrases": ["what is a deepfake", "what are deepfakes", "define deepfake"],
        "keywords": ["deepfake", "deepfakes"],
        "answer": (
            "A **deepfake** is media where someone's face or voice has been synthetically "
            "replaced or generated, usually with a neural network.\n\n"
            "The common kinds this system is trained on:\n"
            "- **Face swap** — one person's face mapped onto another's head\n"
            "- **Face reenactment** — driving a real face's expressions from another video\n"
            "- **Fully synthetic faces** — people who never existed, from a GAN or diffusion model\n\n"
            "They all leave traces: blending seams at the face boundary, inconsistent lighting, "
            "and frame-to-frame flicker that a human eye glides over but a network can measure."
        ),
        "followups": ["How does OmniGuard detect them?", "What are the limitations?"],
    },
    {
        "id": "how_it_works",
        "phrases": ["how does it work", "how does this work", "how do you detect",
                    "how does detection work", "explain the system", "how it works",
                    "what happens when i upload"],
        "keywords": ["work", "works", "pipeline", "process", "detect", "architecture"],
        "answer": (
            "Every upload runs the same pipeline:\n\n"
            "1. **Find the faces** — OpenCV YuNet locates each face and five landmarks\n"
            "2. **Crop with margin** — 20% wider than the box, because a face swap's blend seam "
            "sits just *outside* where the detector draws the line\n"
            "3. **Classify** — each crop goes through several fine-tuned CNNs, and their votes "
            "are averaged into one probability\n"
            "4. **Explain** — a Class Activation Map shows which regions pushed the score up\n"
            "5. **Corroborate** — EXIF metadata, Error Level Analysis and C2PA provenance are "
            "checked independently of the neural network\n\n"
            "For video, frames are sampled across the clip, each person is tracked by face "
            "embedding, and their score is measured *over time* — the flicker is itself a signal."
        ),
        "followups": ["What is the heatmap?", "How does video tracking work?"],
    },
    {
        "id": "heatmap",
        "strong": ['heatmap', 'cam'],
        "phrases": ["what is the heatmap", "what does the heatmap show", "explain heatmap",
                    "class activation", "grad cam", "why is it fake", "how do you know"],
        "keywords": ["heatmap", "heat", "cam", "activation", "explainability", "colours", "colors"],
        "answer": (
            "The heatmap is a **Class Activation Map**. Red areas are the regions that pushed the "
            "score toward 'fake'; blue areas argued for 'real'.\n\n"
            "It's not decoration — it's the actual arithmetic. These networks end in "
            "global-average-pooling followed by a single linear layer, which means the 'fake' "
            "score decomposes exactly into a weighted sum over the final feature map:\n\n"
            "`cam(y,x) = Σ W[fake,c] · features[c,y,x]`\n\n"
            "So the picture is a faithful spatial breakdown of the decision, not an approximation. "
            "On a real face swap you'd expect heat concentrated around the jawline, hairline and "
            "the edges of the eyes and mouth — the places blending is hardest."
        ),
        "followups": ["Why not Grad-CAM?", "How does it work?"],
    },
    {
        "id": "gradcam",
        "strong": ['gradcam'],
        "phrases": ["why not grad cam", "why not gradcam", "difference between cam and grad"],
        "keywords": ["gradcam", "gradient", "gradients", "backprop"],
        "answer": (
            "Grad-CAM needs gradients, which means backpropagation — and inference here runs on "
            "**ONNX Runtime**, which only does forward passes.\n\n"
            "Because these architectures pool then apply one linear layer, plain CAM is not an "
            "approximation of Grad-CAM — for this network shape the two are mathematically "
            "equivalent, and CAM needs nothing but the forward pass already computed. Each model "
            "exports a second output (`features`) alongside its predictions to make that possible.\n\n"
            "The result: the same explanation, no PyTorch on your laptop, ~100 ms per face on CPU."
        ),
        "followups": ["Why ONNX instead of PyTorch?"],
    },
    {
        "id": "onnx",
        "strong": ['onnx'],
        "phrases": ["why onnx", "what is onnx", "why not pytorch", "why no gpu"],
        "keywords": ["onnx", "pytorch", "runtime", "gpu", "cpu"],
        "answer": (
            "Training and deployment have genuinely different needs, so they use different runtimes.\n\n"
            "**Training** happens once on Colab's free T4 GPU with PyTorch — that's where you want "
            "a big flexible framework.\n\n"
            "**Inference** runs on your laptop through ONNX Runtime: about 50 MB instead of "
            "PyTorch's 2 GB, and roughly 100 ms per face on a CPU with no graphics card. "
            "That's the difference between this running on your machine and not running at all."
        ),
        "followups": ["How do I train the models?"],
    },
    {
        "id": "ela",
        "strong": ['ela'],
        "phrases": ["what is ela", "error level analysis", "what is error level"],
        "keywords": ["ela", "error", "level", "compression", "splice", "spliced"],
        "answer": (
            "**Error Level Analysis** re-saves the image at a known JPEG quality and measures how "
            "much each region changes.\n\n"
            "Untouched areas are already near their compression fixed point, so they barely move. "
            "A region that was pasted in, generated, or edited has a *different compression "
            "history*, so it moves more. Uneven response across the frame therefore hints at "
            "splicing.\n\n"
            "It's a genuinely independent check — no neural network involved — which is why it's "
            "worth running alongside the model. But it's weak on PNGs and on images that have "
            "been re-compressed many times, so treat it as corroboration, never as proof."
        ),
        "followups": ["What is C2PA?", "What are the limitations?"],
    },
    {
        "id": "c2pa",
        "strong": ['c2pa', 'provenance'],
        "phrases": ["what is c2pa", "content credentials", "what is provenance",
                    "no c2pa signature"],
        "keywords": ["c2pa", "provenance", "credential", "credentials", "signature", "authenticity"],
        "answer": (
            "**C2PA** (Content Credentials) is an industry standard for cryptographically signed "
            "provenance — a manifest embedded in the file recording what device captured it and "
            "what edits were applied.\n\n"
            "Important caveat, and the report states it too: OmniGuard only checks whether a "
            "manifest is **present**. It does not cryptographically validate the signature against "
            "a trust list.\n\n"
            "And 'no C2PA found' is *not* evidence of manipulation — the overwhelming majority of "
            "cameras and editors still don't write one. Its presence is meaningful; its absence "
            "mostly isn't."
        ),
        "followups": ["What is ELA?", "Can I trust the verdict?"],
    },
    {
        "id": "metrics",
        "strong": ['roc', 'auc', 'f1', 'precision', 'recall'],
        "phrases": ["what is roc auc", "what is precision", "what is recall", "what is f1",
                    "what do the metrics mean", "explain the metrics", "what is auc"],
        "keywords": ["precision", "recall", "f1", "auc", "roc", "metric", "metrics"],
        "answer": (
            "The five numbers on the Model Comparison page:\n\n"
            "- **Accuracy** — share of test images judged correctly. Easy to read, but misleading "
            "if the classes are imbalanced.\n"
            "- **Precision** — of everything the model called fake, how much really was. Low "
            "precision means false accusations.\n"
            "- **Recall** — of all the real fakes, how many it caught. Low recall means fakes slip "
            "through.\n"
            "- **F1** — the harmonic mean of precision and recall, for when you need one number.\n"
            "- **ROC-AUC** — how well the model *ranks* fakes above reals, independent of where you "
            "put the threshold. 0.5 is coin-flipping; 1.0 is perfect.\n\n"
            "For deepfake detection, precision and recall pull in opposite directions and which "
            "matters more depends on your use case — a newsroom fears false accusations, a platform "
            "fears misses."
        ),
        "followups": ["How accurate are the models?", "How are the thresholds set?"],
    },
    {
        "id": "thresholds",
        "strong": ['threshold', 'thresholds'],
        "phrases": ["how are thresholds set", "what is the threshold", "why suspicious",
                    "what makes something suspicious"],
        "keywords": ["threshold", "thresholds", "cutoff", "suspicious", "bands"],
        "answer": (
            f"The ensemble outputs a probability that the face is manipulated, and that maps onto "
            f"three bands:\n\n"
            f"- **Authentic** — below {cfg.SUSPICIOUS_THRESHOLD:.0%}\n"
            f"- **Suspicious** — {cfg.SUSPICIOUS_THRESHOLD:.0%} to {cfg.FAKE_THRESHOLD:.0%}\n"
            f"- **Fake / Manipulated** — above {cfg.FAKE_THRESHOLD:.0%}\n\n"
            f"The middle band exists on purpose. A binary real/fake call hides genuine uncertainty, "
            f"and on a question this consequential, 'I'm not sure' is a more honest output than a "
            f"confident coin-flip.\n\n"
            f"You can change these in `backend/config.py`."
        ),
        "followups": ["Can I trust the verdict?", "What do the metrics mean?"],
    },
    {
        "id": "video",
        "strong": ['temporal'],
        "phrases": ["how does video work", "video detection", "temporal consistency",
                    "how do you track people", "what is temporal"],
        "keywords": ["video", "frames", "temporal", "tracking", "track", "flicker"],
        "answer": (
            "Video isn't analysed frame-by-frame end to end — that would take minutes on a CPU. "
            "Instead:\n\n"
            f"1. **{cfg.VIDEO_MAX_FRAMES} frames** are sampled evenly across the clip\n"
            "2. Every face in each frame is detected and scored\n"
            "3. People are **tracked** across frames by face embedding, so one forged person in a "
            "two-person interview isn't diluted by the genuine one\n"
            "4. Each person's scores are measured **over time**\n\n"
            "That last step is the interesting one. A real face scores consistently. A swapped face "
            "*flickers* — the generator struggles with unusual poses, blinking and occlusion, so the "
            "score jumps around. The standard deviation of a person's scores captures this directly, "
            "and a high value is flagged as temporal inconsistency.\n\n"
            "The overall clip score weights the peak (0.6 × max + 0.4 × mean), because a convincing "
            "fake only breaks down in *some* frames and averaging would hide exactly the evidence "
            "you care about."
        ),
        "followups": ["How does face recognition work?", "How does it work?"],
    },
    {
        "id": "face_recognition",
        "strong": ['sface', 'embedding', 'enroll', 'enrol'],
        "phrases": ["how does face recognition work", "what is face recognition",
                    "how does identity work", "enroll a face", "face matching"],
        "keywords": ["recognition", "identity", "enroll", "enrol", "sface", "embedding",
                     "match", "gallery", "who"],
        "answer": (
            "Face recognition uses **SFace**, which turns a face into a 128-number vector — an "
            "'embedding' — where the same person's photos land close together and different people "
            "land far apart.\n\n"
            "On the Face Recognition page you can enrol someone by name. Only the vector is stored, "
            "never the photograph. Enrolling the same person again averages the vectors, which makes "
            "matching more robust across pose and lighting.\n\n"
            "When you then identify an image, each face is matched against the gallery **and** scored "
            "for manipulation at the same time. That pairing is the point: *'this claims to be X, and "
            "the face is manipulated'* is the useful statement — neither half means much alone.\n\n"
            f"Two faces are called a match above {cfg.IDENTITY_MATCH_THRESHOLD} cosine similarity, "
            f"which is OpenCV's recommended threshold for this model."
        ),
        "followups": ["How does video tracking work?", "Is my data stored?"],
    },
    {
        "id": "training",
        "strong": ['colab'],
        "phrases": ["how do i train", "how to train", "train the models", "colab",
                    "no models loaded", "models missing", "how do i get models"],
        "keywords": ["train", "training", "colab", "notebook", "gpu", "dataset", "missing"],
        "answer": (
            "Training runs once on Google Colab's free GPU — it can't run on this laptop, which has "
            "no graphics card.\n\n"
            "1. Go to **colab.research.google.com** → File → Upload notebook\n"
            "2. Upload `notebooks/OmniGuard_Training.ipynb`\n"
            "3. **Runtime → Change runtime type → T4 GPU → Save**\n"
            "4. **Runtime → Run all**, then leave it about 50 minutes\n"
            "5. Unzip the downloaded `omniguard_models.zip` into `backend/models/`\n"
            "6. Restart the server\n\n"
            "No Kaggle account or dataset request forms — everything is pulled anonymously from "
            "Hugging Face."
        ),
        "followups": ["What were the models trained on?", "How accurate are the models?"],
    },
    {
        "id": "dataset",
        "strong": ['dataset', 'faceforensics'],
        "phrases": ["what dataset", "what data", "trained on what", "which dataset",
                    "faceforensics", "what were the models trained on"],
        "keywords": ["dataset", "data", "faceforensics", "trained", "corpus"],
        "answer": (
            "The models are fine-tuned on **FaceForensics++** face crops — around 190,000 images, "
            "and the standard academic benchmark for this task.\n\n"
            "It contains real forgeries produced by four different methods: Deepfakes, Face2Face, "
            "FaceSwap and NeuralTextures. Training across all four is what stops the model latching "
            "onto the quirks of any single generator.\n\n"
            "The most valuable trick during training is **JPEG augmentation** — randomly "
            "re-compressing images. Without it the network learns compression artifacts instead of "
            "forgery artifacts, and falls apart the moment a picture is re-saved or passed through "
            "social media."
        ),
        "followups": ["What are the limitations?", "How accurate are the models?"],
    },
    {
        "id": "limitations",
        "strong": ['limitation', 'limitations'],
        "phrases": ["what are the limitations", "can i trust", "is it reliable", "how reliable",
                    "is it accurate enough", "should i trust", "weaknesses", "what can go wrong"],
        "keywords": ["limitation", "limitations", "trust", "reliable", "reliability", "wrong",
                     "false", "weakness", "caveat"],
        "answer": (
            "Worth being straight about, because these are real:\n\n"
            "- It detects **face-based** forgery. It is *not* a general 'was this made by AI' "
            "detector — a synthetic landscape is outside what it was trained on.\n"
            "- Images with **no detectable face** fall back to whole-frame analysis, which is "
            "markedly less reliable. The report says so when that happens.\n"
            "- Accuracy is measured on a held-out split of the *same* dataset. Cross-dataset "
            "generalisation is the harder benchmark and isn't claimed here.\n"
            "- Heavy compression, low resolution and small faces all degrade the signal.\n"
            "- C2PA is a presence check, not signature validation.\n\n"
            "The honest framing: **a verdict is evidence, not proof.** It belongs as one input to a "
            "human decision, not as a replacement for one. Treat a 'Suspicious' result as 'look "
            "closer', not as an accusation."
        ),
        "followups": ["How are the thresholds set?", "What is the heatmap?"],
    },
    {
        "id": "privacy",
        "strong": ['privacy'],
        "phrases": ["is my data stored", "do you upload my files", "where do files go",
                    "is it private", "do you send data", "privacy"],
        "keywords": ["privacy", "private", "stored", "store", "cloud", "upload", "sent", "data"],
        "answer": (
            "Everything runs locally on your machine. Nothing is sent anywhere.\n\n"
            "- Uploaded files are **deleted immediately** after analysis\n"
            "- Reports are stored in a local SQLite database (`backend/data/omniguard.db`)\n"
            "- Enrolled faces store only the 128-number embedding, never the photograph\n"
            "- The models run on your CPU; there is no external API call in the detection path\n\n"
            "You can delete any scan from the History page."
        ),
        "followups": ["How does face recognition work?"],
    },
    {
        "id": "formats",
        "strong": ['formats'],
        "phrases": ["what formats", "what files can i upload", "supported formats",
                    "can i upload", "what file types"],
        "keywords": ["format", "formats", "filetype", "supported", "upload", "jpg", "png", "mp4"],
        "answer": (
            f"**Images:** {', '.join(sorted(e.lstrip('.').upper() for e in cfg.ALLOWED_IMAGE_EXT))}\n\n"
            f"**Videos:** {', '.join(sorted(e.lstrip('.').upper() for e in cfg.ALLOWED_VIDEO_EXT))}\n\n"
            f"Maximum upload size is {cfg.MAX_UPLOAD_MB} MB.\n\n"
            f"Audio, text and document detection are not built — they're marked 'soon' in the "
            f"sidebar rather than shown as controls that don't do anything."
        ),
        "followups": ["Why no audio detection?"],
    },
    {
        "id": "audio",
        "strong": ['audio', 'voice'],
        "phrases": ["why no audio", "when will audio", "audio detection", "voice cloning"],
        "keywords": ["audio", "voice", "sound", "speech", "microphone"],
        "answer": (
            "Audio isn't built yet, and it's deliberately labelled that way rather than faked.\n\n"
            "Voice-cloning detection is a genuinely separate problem: it needs a different model "
            "(typically a CNN over mel-spectrograms), a different dataset (ASVspoof or WaveFake) "
            "and its own training run. Bolting a fake indicator onto the UI would have been quicker "
            "and dishonest.\n\n"
            "The architecture leaves room for it — the pipeline is modular and a second detector "
            "would slot in beside the visual one."
        ),
        "followups": ["What formats are supported?"],
    },
    {
        "id": "improve",
        "phrases": ["how can i improve", "make it more accurate", "better accuracy",
                    "improve the model", "how to make it better"],
        "keywords": ["improve", "better", "tune", "tuning", "optimize", "optimise"],
        "answer": (
            "Biggest wins, roughly in order of payoff:\n\n"
            "1. **Train on more data** — raise `--n-train` toward the full 140k. The default of "
            "45k is a speed compromise.\n"
            "2. **More epochs** — 3 is a time-box, not an optimum. Try 6-8.\n"
            "3. **Higher resolution** — `--img-size 299` captures finer blending artifacts, at "
            "roughly double the training time.\n"
            "4. **Add a second dataset** — training across FaceForensics++ *and* Celeb-DF is what "
            "buys cross-dataset generalisation, which is the weakest point right now.\n\n"
            "All of these are flags on `training/train.py`, and the notebook passes them straight "
            "through."
        ),
        "followups": ["How do I train the models?", "What are the limitations?"],
    },
    {
        "id": "help",
        "phrases": ["what can you do", "help me", "what can i ask", "who are you",
                    "what are you"],
        "keywords": ["help", "assist", "commands", "options"],
        "answer": (
            "I'm the built-in OmniGuard assistant. I can explain how the detection works, what any "
            "part of a report means, and read your live scan data.\n\n"
            "Things worth asking:\n"
            "- *What does my last scan mean?*\n"
            "- *How does the detection actually work?*\n"
            "- *What is the heatmap showing?*\n"
            "- *How accurate are the models?*\n"
            "- *Can I trust this verdict?*\n"
            "- *How do I train the models?*\n\n"
            "Fair warning: I answer from a curated knowledge base, not a language model. So I'm "
            "accurate about this system, and I'll tell you when something is outside what I know "
            "rather than guess."
        ),
        "followups": ["How does it work?", "What are the limitations?"],
    },
]

FALLBACK = (
    "I don't have an answer for that one — I work from a curated knowledge base about this "
    "system, so I'd rather say so than invent something.\n\n"
    "Try asking about: how detection works, the heatmap, model accuracy, thresholds, "
    "video tracking, face recognition, training, or the limitations."
)

DEFAULT_FOLLOWUPS = [
    "How does it work?",
    "What does my last scan mean?",
    "Can I trust the verdict?",
    "How accurate are the models?",
]


def _live_context(detector_info: dict | None) -> dict:
    recent = db.recent_scans(limit=1)
    return {
        "stats": db.stats(),
        "last_scan": recent[0] if recent else None,
        "detector": detector_info or {},
    }


def score_intent(question: str, entry: dict) -> float:
    """Phrase hits dominate; individual keywords accumulate more slowly.

    Four tiers, strongest first:
      2.5  exact phrase in the raw question
      2.0  multi-word phrase matches once both sides drop their stopwords
      2.0  a `strong` keyword - a term distinctive enough to decide alone
      1.0  per distinct ordinary keyword

    Single-word phrases are excluded from the stopword-stripped tier: after
    stripping, "how does it work" collapses to just "work", which would then
    outrank the more specific intent for "how does video tracking work".
    """
    lowered = question.lower()
    q_tokens = _token_list(question)

    score = 0.0
    for phrase in entry.get("phrases", []):
        if phrase in lowered:
            score += 2.5
            continue
        p_tokens = _token_list(phrase)
        if len(p_tokens) >= 2 and _contains_run(q_tokens, p_tokens):
            score += 2.0

    words = set(q_tokens)
    score += 2.0 * len(words & set(entry.get("strong", [])))
    score += len(words & set(entry.get("keywords", [])))
    return score


def ask(question: str, detector_info: dict | None = None) -> dict:
    question = (question or "").strip()
    if not question:
        return {"answer": FALLBACK, "intent": None, "confidence": 0.0,
                "followups": DEFAULT_FOLLOWUPS}

    ranked = sorted(
        ((score_intent(question, e), e) for e in KNOWLEDGE),
        key=lambda pair: pair[0], reverse=True,
    )
    best_score, best = ranked[0]

    # One bare keyword is too thin to act on - better to offer options than to
    # confidently answer the wrong question.
    if best_score < 1.5:
        return {"answer": FALLBACK, "intent": None, "confidence": 0.0,
                "followups": DEFAULT_FOLLOWUPS}

    answer = best["answer"]
    if callable(answer):
        answer = answer(_live_context(detector_info))

    return {
        "answer": answer,
        "intent": best["id"],
        "confidence": round(min(best_score / 5.0, 1.0), 2),
        "followups": best.get("followups", DEFAULT_FOLLOWUPS)[:3],
    }
