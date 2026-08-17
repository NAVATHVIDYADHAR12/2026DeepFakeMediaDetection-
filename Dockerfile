# OmniGuard AI - backend container.
#
# This exists because the API cannot run on Vercel: its dependencies total
# ~260 MB installed (OpenCV alone is ~117 MB) against a 250 MB serverless
# function limit, before any models, and it needs a writable disk for SQLite.
# Any container host with ~1 GB of image budget runs it comfortably.
#
#   docker build -t omniguard .
#   docker run -p 8000:8000 omniguard

FROM python:3.12-slim

# libGL and libglib are the only system libraries OpenCV needs once the
# headless wheel is used; curl is used to fetch the face models on first boot.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not invalidate the layer.
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY backend/ ./backend/

# Serve the built dashboard from the same origin when it is present. This is
# optional: the frontend is normally deployed separately to Vercel.
COPY frontend/dist* ./frontend/dist/

ENV OMNIGUARD_HOST=0.0.0.0 \
    OMNIGUARD_DATA_DIR=/data \
    PYTHONUNBUFFERED=1

# Hosts that mount a volume will overwrite this; those that do not still get a
# writable directory rather than failing on a read-only image.
RUN mkdir -p /data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://localhost:${PORT:-8000}/api/health || exit 1

CMD ["python", "backend/main.py"]
