# Deployment

Read this first — it explains what runs where, and why.

---

## The short version

| Part | Where it runs | Works after `git clone`? |
|---|---|---|
| Frontend (all pages, animations, docs) | **Vercel** — static | ✅ yes |
| Forensics: EXIF, ELA, C2PA, history | **The browser** | ✅ yes |
| Face detection + recognition | Python service | ✅ yes — models are committed |
| **Deepfake verdict** | Python service | ⚠️ **needs training first** |

**Vercel hosts the frontend only.** The backend cannot run there, and that is a
measurement rather than a preference:

| Constraint | Reality |
|---|---|
| Vercel serverless limit | 250 MB unzipped |
| Dependencies, normal wheels | ~223 MB |
| Dependencies, headless wheels | **~261 MB** — still over, before any model |
| Filesystem | read-only except an ephemeral `/tmp`; SQLite needs a writable disk |
| Timeout | video analysis samples 32 frames and can exceed it |

Everything needed to host the backend elsewhere is in this repository:
`Dockerfile`, `render.yaml`, `requirements-server.txt`.

---

## Hosting the frontend: Vercel or Netlify

Both are configured and equivalent — `vercel.json` and `netlify.toml` produce
the same static build. Pick either; the instructions below say Vercel, and
Netlify works identically.

Neither can host the backend:

| Host | Function limit | This backend |
|---|---|---|
| Vercel | 250 MB unzipped | ~261 MB unzipped |
| Netlify | 50 MB **zipped** | ~100 MB zipped |

Netlify is the tighter of the two, so it is not a way around the constraint.

## Path A — frontend only (2 minutes)

Gets you a live URL where every page works.

1. Vercel → **Add New → Project** → import this repository
2. Leave every setting alone — `vercel.json` handles it
3. Deploy

**What works:** landing page, Dashboard, Scanner, Report, History, Models,
System, sign-up UI, documentation.

**What the Scanner does:** real analysis in your browser — EXIF metadata,
Error Level Analysis, C2PA provenance — with history saved in IndexedDB. The
verdict shows **"Not verified"** because no classifier is loaded. That is
deliberate: a guessed score would be worse than an absent one.

---

## Path B — Vercel + a real backend (15 minutes)

Adds face detection, face recognition, video, accounts and the assistant.

### 1. Deploy the backend

**Render** (free, blueprint included):

1. Render → **New → Blueprint** → point at this repository
2. Set `OMNIGUARD_ALLOWED_ORIGINS` to your Vercel URL, e.g.
   `https://your-app.vercel.app`
3. Deploy, then copy the service URL

Any Docker host works the same way:

```bash
docker build -t omniguard .
docker run -p 8000:8000 \
  -e OMNIGUARD_HOST=0.0.0.0 \
  -e OMNIGUARD_CROSS_SITE=1 \
  -e OMNIGUARD_ALLOWED_ORIGINS=https://your-app.vercel.app \
  omniguard
```

The face models are committed, so the image is self-contained — no download
step, no first-boot fetch.

### 2. Point the frontend at it

In the Vercel project, add an environment variable and redeploy:

```
VITE_API_BASE = https://your-backend.onrender.com
```

That is the whole wiring. The frontend detects the backend on load and stops
using its browser engine.

> **Free-tier caveats.** Render's free instance sleeps after 15 minutes idle
> and takes ~50 s to wake, so the first request after a pause is slow. Its disk
> is ephemeral, so accounts and scan history reset on restart.

---

## Path C — Full detection

Everything above, plus actual deepfake verdicts, heatmaps and video analysis.

The classifiers are the one thing not in this repository, because they come out
of a training run rather than being downloadable. **Train them once:**

1. <https://colab.research.google.com> → **File → Upload notebook**
2. Upload `notebooks/OmniGuard_Training.ipynb`
3. **Runtime → Change runtime type → T4 GPU → Save**
4. **Runtime → Run all**, then leave it ~50 minutes
5. Unzip the downloaded `omniguard_models.zip` into `backend/models/`

No Kaggle account, no dataset forms, no API tokens — the datasets are pulled
anonymously from HuggingFace.

Then either run locally with `START.bat`, or commit the `.onnx` files and
redeploy the backend:

```bash
git add -f backend/models/*.onnx backend/models/*.npy backend/models/manifest.json
git commit -m "Add trained classifiers"
git push
```

They are gitignored by default only because they are training-specific;
`-f` overrides that deliberately.

---

## Running locally

Double-click **`START.bat`**. It creates the Python environment, installs
dependencies, builds the dashboard and opens <http://127.0.0.1:8000>.

Development, with hot reload:

```bash
python backend/main.py          # API on :8000
cd frontend && npm run dev      # UI on :5173, proxies /api to :8000
```

Tests:

```bash
.venv\Scripts\python.exe -m pytest backend/tests -q
```

---

## Environment variables

All optional. The defaults are exactly the local behaviour.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `OMNIGUARD_PORT` | `8000` | Most hosts inject `PORT` |
| `OMNIGUARD_HOST` | `127.0.0.1` | Set `0.0.0.0` in a container |
| `OMNIGUARD_DATA_DIR` | `backend/data` | Move SQLite and uploads to a writable volume |
| `OMNIGUARD_ALLOWED_ORIGINS` | *(none)* | Comma-separated origins allowed to call the API; localhost is always permitted |
| `OMNIGUARD_CROSS_SITE` | `0` | Set `1` when the frontend is on another domain — issues the session cookie as `SameSite=None; Secure`, without which the browser will not send it |
| `OMNIGUARD_AUTO_DOWNLOAD` | `1` | Fetch face models if missing (they are committed, so normally a no-op) |
| `VITE_API_BASE` | *(none)* | **Frontend build-time.** Backend origin when hosted separately |

A wildcard CORS origin is impossible here by design: `*` is invalid alongside
credentials, and the browser would discard every authenticated response.

---

## What is in the repository

```
frontend/          React + Vite + Tailwind + Sass + GSAP
  src/engine/      browser-side forensics, used when no backend is present
  public/          logo, self-hosted fonts, hero frames, documentation
backend/           FastAPI service
  models/          YuNet + SFace, committed (38 MB)
  tests/           205 tests
notebooks/         Colab training notebook
training/train.py  the training code the notebook runs
Dockerfile         backend container
render.yaml        one-click backend blueprint
vercel.json        frontend static build
```
