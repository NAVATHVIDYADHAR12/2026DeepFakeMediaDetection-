# Deployment

Read this first — it explains what runs where, and why.

---

## The short version

**One Render service hosts the entire app.** The Dockerfile is multi-stage —
Node builds the dashboard, Python serves both it and the API from one process —
so a single deployment is the complete product on one URL.

Because it is a single origin, there is **no CORS to configure and no
cross-site cookie handling**. That is the simplest and most robust arrangement,
and it is why the blueprint has almost nothing in it.

| Host | Free | Runs the backend? | Notes |
|---|---|---|---|
| **Render** | yes | **yes** | Blueprint included. Sleeps after 15 min idle. |
| Hugging Face Spaces | yes, no card | **yes** | Also whole-app; pauses after ~48 h |
| Fly.io / Railway / Cloud Run | limited | yes | More setup |
| Vercel / Netlify | yes | **no** | Frontend only — 250 MB / 50 MB limits vs ~261 MB |

---

## Path A - Render (recommended)

1. <https://render.com> -> **New -> Blueprint**
2. Connect this repository
3. Click **Apply**

That is the whole process. `render.yaml` and the `Dockerfile` do the rest: no
environment variables to set, no `VITE_API_BASE`, no CORS origins.

First build takes ~10-15 minutes (it installs OpenCV and ONNX Runtime, then
compiles the dashboard). After that the app is live at
`https://omniguard.onrender.com` — Render will show the exact URL.

**Verified working on this exact configuration:** landing page, Dashboard,
Scanner, Report, History, Models, System, Face ID, sign-up and sessions,
assistant, documentation, and every forensic check. Warm scans run in ~0.15 s.

Deepfake verdicts still need the trained classifiers - see Path C.

> **Free plan, worth knowing before a demo.** The instance sleeps after 15
> minutes of inactivity and takes roughly 50 seconds to wake, so open the URL a
> minute before showing it. Its disk is ephemeral: accounts and scan history
> reset when it restarts. A paid instance with a mounted disk fixes both.

---

## Path B - Hugging Face Spaces

Also hosts the whole app, free, without a card, and does not sleep as
aggressively.

1. <https://huggingface.co> -> **New -> Space**
2. SDK **Docker**, template **Blank**
3. Push this repository to the Space:

```bash
git remote add space https://huggingface.co/spaces/YOUR_NAME/YOUR_SPACE
git push space main
```

The Space reads its configuration from the README frontmatter.

---

## Path B2 - split: frontend on Vercel or Netlify

Only worth it if you specifically want a CDN-hosted frontend. `vercel.json` and
`netlify.toml` are both committed.

Without a backend the app runs its browser engine - real EXIF, Error Level
Analysis, C2PA and local history - and shows *Not verified* instead of a
guessed score.

To attach a backend hosted elsewhere, set a build-time variable on the frontend:

```
VITE_API_BASE = https://your-backend-host
```

and on the backend set `OMNIGUARD_CROSS_SITE=1` plus
`OMNIGUARD_ALLOWED_ORIGINS=https://your-frontend-url`, because a cookie sent
across sites must be `SameSite=None; Secure`. Deploying everything on Render
avoids all of that.

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
