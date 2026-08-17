---
title: OmniGuard AI
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
license: apache-2.0
short_description: Deepfake and AI-generated media detection with explainable verdicts
---

# 🛡️ OmniGuard AI — Deepfake & AI-Generated Media Detection

Detects manipulated faces in **images and video** using an ensemble of fine-tuned convolutional
neural networks, and explains *why* it reached its verdict.

Built to run on an ordinary laptop with **no GPU**: training happens once on Google Colab's free
GPU, and inference runs through ONNX Runtime on CPU in roughly 200 ms per image.

---

## Quick start

**Double-click `START.bat`.** That is the whole process.

It creates the Python environment, installs dependencies, downloads the face models, builds the
dashboard, and opens <http://127.0.0.1:8000>. Everything after the first run is instant.

> **Detection needs trained models.** Until you run the training step below, the app starts and
> the interface works, but scanning returns a clear "no models loaded" message rather than a
> fabricated score.

### Training the models (once, ~50 minutes, unattended)

1. Open <https://colab.research.google.com> → **File → Upload notebook**
2. Upload `notebooks/OmniGuard_Training.ipynb`
3. **Runtime → Change runtime type → T4 GPU → Save**
4. **Runtime → Run all**, then leave it alone
5. `omniguard_models.zip` downloads at the end — unzip it into `backend/models/`
6. Run `START.bat` again

No Kaggle account, no dataset forms, no API tokens. The datasets are pulled anonymously from
Hugging Face.

---

## Deploying

**Recommended: one Hugging Face Space hosts the entire app, free.**

FastAPI serves the built dashboard as well as the API, so a single container is
the whole product — landing page, dashboard, scanner, face recognition,
accounts, assistant, documentation — on one URL. No split deployment, no CORS,
no environment variables to wire up.

| Host | Free? | Runs the backend? | Notes |
|---|---|---|---|
| **Hugging Face Spaces** | yes, no card | **yes** | 2 vCPU, 16 GB RAM, 16 GB disk. Built for ML. **Best fit.** |
| Render | yes | yes | Sleeps after 15 min idle, ~50 s cold start |
| Fly.io / Railway / Cloud Run | limited free | yes | Fine, more setup |
| Vercel / Netlify | yes | **no** | Frontend only — see the limits below |

Vercel and Netlify cannot run this backend:

| | Function limit | This backend |
|---|---|---|
| Vercel | 250 MB unzipped | ~261 MB unzipped |
| Netlify | 50 MB **zipped** | ~100 MB zipped |

OpenCV alone is ~117 MB. Netlify is the tighter of the two, so switching
between them changes nothing.

### Option 1 — Hugging Face Spaces (everything, free)

1. Sign in at <https://huggingface.co> → **New → Space**
2. Name it, choose **Docker** as the SDK, and **Blank** as the template
3. Create the Space, then push this repository to it:

```bash
git remote add space https://huggingface.co/spaces/YOUR_NAME/YOUR_SPACE
git push space main
```

That is all. The Space reads the configuration from this README's frontmatter,
builds the container — Node compiles the dashboard, Python installs the backend —
and serves the whole app at
`https://YOUR_NAME-YOUR_SPACE.hf.space`.

First build takes roughly 5–10 minutes. After that it is live.

> Free Spaces pause after ~48 hours of inactivity and restart on the next
> visit. Their disk resets on restart, so accounts and scan history do not
> survive a rebuild — fine for a demo.

### Option 2 — frontend on Vercel or Netlify

Both are configured (`vercel.json`, `netlify.toml`). Import the repository and
deploy; no settings needed.

Without a backend the app runs its **browser engine**: real EXIF parsing, real
Error Level Analysis, real C2PA detection, history in IndexedDB. Deepfake
verdicts show as *Not verified* rather than a guessed number.

To add the backend, host it anywhere from the list above and set one build-time
variable in the frontend project:

```
VITE_API_BASE = https://your-backend-host
```

The backend then needs `OMNIGUARD_CROSS_SITE=1` and
`OMNIGUARD_ALLOWED_ORIGINS=https://your-frontend-url`, because a cookie sent
across sites must be `SameSite=None; Secure`.

### Detection still needs trained models

Any deployment answers health, auth, assistant, face detection and forensics
immediately. **Scan verdicts require the trained classifiers**, which come out
of the Colab run above — they are not downloadable. Unzip
`omniguard_models.zip` into `backend/models/`, commit them, and redeploy:

```bash
git add -f backend/models/*.onnx backend/models/*.npy backend/models/manifest.json
git commit -m "Add trained classifiers"
git push
```

### Environment variables

All optional; the defaults are exactly the local behaviour.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `OMNIGUARD_PORT` | `8000` | Most hosts inject `PORT` |
| `OMNIGUARD_HOST` | `127.0.0.1` | Set `0.0.0.0` in a container |
| `OMNIGUARD_DATA_DIR` | `backend/data` | Move SQLite and uploads to a writable volume |
| `OMNIGUARD_ALLOWED_ORIGINS` | *(none)* | Comma-separated origins allowed to call the API; localhost is always permitted |
| `OMNIGUARD_CROSS_SITE` | `0` | `1` when the frontend is on another domain |
| `OMNIGUARD_AUTO_DOWNLOAD` | `1` | Fetch face models if missing (they are committed, so normally a no-op) |
| `VITE_API_BASE` | *(none)* | **Frontend build-time.** Backend origin when hosted separately |

A wildcard CORS origin is impossible by design: `*` is invalid alongside
credentials, and the browser would discard every authenticated response.

## What it actually does

| Capability | Status | How |
|---|---|---|
| Image deepfake detection | **Working** | Ensemble of 3 fine-tuned CNNs, per-face |
| Video deepfake detection | **Working** | Frame sampling + per-person tracking + temporal variance |
| Face detection | **Working** | OpenCV YuNet (CPU, 5 landmarks) |
| Face recognition / identity | **Working** | OpenCV SFace, 128-d embeddings, enrollable gallery |
| Explainability heatmap | **Working** | Class Activation Map, computed forward-only |
| Metadata & EXIF forensics | **Working** | Pillow — camera, software traces, GPS, stripping |
| Error Level Analysis | **Working** | JPEG recompression residual, block-level spread |
| C2PA provenance | **Presence check only** | Detects the manifest; does *not* verify its signature |
| In-app assistant | **Working** | Curated knowledge base + live scan data (not an LLM) |
| Audio / text / document | **Not built** | Labelled "coming soon" in the UI, not faked |

The interface marks unbuilt modules plainly. Nothing in this project shows invented numbers.

---

## How it works

```
                    ┌──────── ONE-TIME, ON COLAB'S FREE GPU ────────┐
                    │  FaceForensics++ face crops (~190k images)    │
                    │            ↓                                  │
                    │  fine-tune EfficientNet-B0 / Xception /       │
                    │            MobileNetV3                        │
                    │            ↓                                  │
                    │  evaluate on held-out test set → ONNX export  │
                    └───────────────────┬───────────────────────────┘
                                        │ models.zip
   ┌────────────────────────────────────▼──────────────────────────────┐
   │                     ON YOUR LAPTOP (CPU ONLY)                     │
   │                                                                   │
   │   upload → YuNet face detect → crop w/ 20% margin                 │
   │              ↓                                                    │
   │        ONNX ensemble (3 models vote)  →  fake probability         │
   │              ↓                                                    │
   │        CAM heatmap  +  EXIF  +  ELA  +  C2PA  →  report           │
   └───────────────────────────────────────────────────────────────────┘
```

### Design decisions worth defending

**Why ONNX instead of PyTorch locally.** PyTorch is a 2 GB install that runs slowly on a 2-core
CPU. ONNX Runtime is ~50 MB and executes the same graph in ~100 ms per face. The training rig and
the deployment rig have genuinely different requirements, so they use different runtimes.

**Why CAM rather than Grad-CAM.** Grad-CAM needs backpropagation, which ONNX Runtime does not do.
Because these networks end in global-average-pool → linear, the fake logit decomposes *exactly*
into a weighted sum of the final feature-map channels:

```
cam(y, x) = Σ_c  W[fake, c] · features[c, y, x]
```

That is computable in pure NumPy from the forward pass we already ran. Same picture, no gradients.
Each model exports two outputs (`logits`, `features`) to make this possible.

**Why a 20% crop margin.** The blend seam of a face swap sits just *outside* the detector's
bounding box. Cropping tight to the box throws away the most informative pixels.

**Why JPEG augmentation during training.** Without it the network learns compression artifacts
instead of forgery artifacts, and collapses the moment an image is re-saved or passed through
social media. It is the single highest-value augmentation for this task.

**Why the peak frame is weighted in video.** A convincing deepfake only breaks down in *some*
frames. Averaging hides that, so the video score is `0.6 × peak + 0.4 × mean`.

**Why temporal variance is a signal.** A genuine face scores consistently across frames. A swapped
one flickers as the generator struggles with pose, blinking and occlusion. The per-person standard
deviation captures this directly.

**Why the assistant isn't a language model.** The in-app chat (`backend/assistant.py`) answers from
a curated knowledge base and can query the live database, so figures it quotes are real. A
generative model would need an API key, a network round trip and per-message cost — and it could
confidently invent claims about how this system works. A curated base can't: every answer is one a
person wrote and can defend, and it says "I don't know" rather than guessing. The chat header
states this openly rather than implying an AI it isn't.

Question routing is four-tier — exact phrase, stopword-insensitive phrase, distinctive single term,
then ordinary keywords — which is what lets "explain c2pa" and "how are **the** thresholds set" land
correctly without a keyword list per phrasing.

**Why the theme is authored in Sass.** The "Stark Quantum" palette lives in
`frontend/src/styles/_tokens.scss` as Sass variables and a map, then emits CSS custom properties.
Components only ever reference the custom properties, so the entire interface re-skins from that one
file — no component was edited to change the theme. Surface and border steps are *derived* with
`color.adjust` rather than hand-picked, which keeps the elevation ladder even.

Two things the palette needed on contact with reality:

- **It had no red.** Amber covered "warning", but the Fake/Manipulated verdict — the most
  consequential state in the app — had no colour. Added Neon Crimson `#FF3B5C`, stepped to sit in
  the same high-voltage family as the cyan and lime.
- **Cyber Cyan is a *light* colour** (14.3:1 against the void). Anything sitting on a cyan button
  needs dark ink; white would have been ~1.2:1, i.e. invisible. Hence the `--on-accent` token.

All twelve foreground/background pairs were checked programmatically, not by eye — everything clears
4.5:1 for text and 3:1 for status colours.

**One accessibility trade-off, made knowingly.** Neon Lime and Plasma Amber sit at ΔE 3.9 under
deuteranopia — for red-green colourblind viewers (~8% of men) the Authentic and Suspicious states are
nearly identical in hue. The palette was chosen deliberately, so the mitigation is that verdict colour
is *never* load-bearing: every verdict ships an icon (`✓` / `!` / `✕`) and its text label, everywhere
it appears. If you ever want the colours themselves to separate, nudging the lime cooler or the amber
toward orange fixes it without touching anything else.

**Why the fonts are self-hosted.** Space Grotesk and Inter are vendored into
`frontend/public/fonts/` (latin subset only, 254 KB) by `tools/fetch_fonts.py`. A dashboard that
pulls from `fonts.gstatic.com` falls back to Times New Roman the moment venue wifi drops — which is
precisely when you are standing in front of judges.

**Why the animations are opacity/transform only.** Every animation in `index.css` moves only those
two properties, which the compositor handles without re-laying-out the page — that matters on a
2-core machine. Panels reveal on scroll via `IntersectionObserver` so content below the fold
animates when you reach it rather than finishing unseen. All of it collapses to nothing under
`prefers-reduced-motion`, and the whole motion layer added ~10 KB with no animation library.

---

## Project layout

```
├── START.bat                     one-click launcher
├── requirements.txt
├── notebooks/
│   └── OmniGuard_Training.ipynb  ← run this on Colab
├── training/
│   └── train.py                  the actual training code (notebook embeds it)
├── tools/
│   └── build_notebook.py         regenerates the notebook from train.py
├── backend/
│   ├── main.py                   FastAPI routes
│   ├── config.py                 every tunable number
│   ├── detector.py               ONNX ensemble + CAM
│   ├── faces.py                  detection · identity · tracking
│   ├── pipeline.py               image analysis
│   ├── video.py                  video analysis
│   ├── forensics.py              EXIF · ELA · C2PA
│   ├── database.py               SQLite history + identity gallery
│   ├── models/                   ONNX models live here
│   ├── tools/make_dummy_model.py placeholder model for testing
│   └── tests/                    113 tests
└── frontend/                     React + Vite + Tailwind dashboard
```

`training/train.py` is the single source of truth for training. The notebook writes that exact
file out and runs it, so the two cannot drift. If you edit `train.py`, regenerate the notebook:

```bash
python tools/build_notebook.py
```

---

## API

Interactive docs at <http://127.0.0.1:8000/docs> while the server is running.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/scan` | Upload image or video; routes automatically |
| `POST` | `/api/scan/image` · `/api/scan/video` | Explicit pipelines |
| `GET` | `/api/scans` · `/api/scan/{id}` | History and full reports |
| `GET` | `/api/stats` | Dashboard aggregates |
| `GET` | `/api/models` | Per-model test metrics |
| `POST` | `/api/identity/enroll` · `/api/identity/match` | Face recognition |
| `GET` | `/api/system/info` | Loaded models, thresholds, limits |

---

## Tests

```bash
.venv\Scripts\python.exe -m pytest backend/tests -q
```

113 tests covering verdict thresholds, face detection and embedding, tracking, the ONNX ensemble,
CAM bounds, forensics, both pipelines, the database, and every HTTP endpoint.

They pass with or without trained models — `backend/tools/make_dummy_model.py` builds a
structurally identical placeholder so every code path is exercised. That placeholder is marked
`"dummy": true` in the manifest and the UI surfaces the warning, so it can never be mistaken for a
trained model.

---

## Honest limitations

These are real, and stating them is better than being caught out by them:

- **It detects face-based forgery.** Trained on FaceForensics++ face crops, so it is strong on face
  swaps and AI-generated faces. It is *not* a general "was this image made by AI" detector — a
  synthetic landscape is outside its training distribution.
- **Images with no detectable face** fall back to whole-frame analysis, which is markedly less
  reliable. The report says so when this happens.
- **C2PA is a presence check.** Cryptographic validation against a trust list is not implemented.
- **ELA is weak** on PNGs and on heavily re-compressed images.
- **Accuracy is measured on a held-out split of the same dataset.** Cross-dataset generalization
  (train on FF++, test on Celeb-DF) is the harder benchmark and is not claimed here.
- **A verdict is evidence, not proof.** It belongs in a human decision, not in place of one.

---

## Configuration

Everything tunable lives in `backend/config.py` — verdict thresholds, crop margin, frame budget,
identity-match threshold, upload limits. Training settings are flags on `training/train.py`:

```bash
python train.py --epochs 5 --batch-size 32 --models efficientnet_b0
```

---

## Built with

Python · PyTorch (training) · timm · ONNX Runtime (inference) · OpenCV (YuNet + SFace) ·
FastAPI · SQLite · React · Vite · Tailwind CSS
