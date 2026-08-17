"""SQLite persistence for scan history and the enrolled-identity gallery.

SQLite ships with Python, so there is no database server to install or run.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

import numpy as np

import config as cfg

# One re-entrant lock guards the whole file. auth.py shares it rather than
# holding its own: two independent locks over the same database is not
# serialisation, it just looks like it.
_lock = threading.RLock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
    scan_id        TEXT PRIMARY KEY,
    created_at     TEXT NOT NULL,
    filename       TEXT NOT NULL,
    media_type     TEXT NOT NULL,
    verdict        TEXT NOT NULL,
    risk_level     TEXT,
    fake_probability  REAL NOT NULL,
    authenticity_score REAL NOT NULL,
    confidence     REAL,
    faces_detected INTEGER DEFAULT 0,
    file_size_bytes INTEGER,
    processing_ms  REAL,
    report_json    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_verdict ON scans(verdict);

CREATE TABLE IF NOT EXISTS identities (
    name        TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    embedding   BLOB NOT NULL,
    sample_count INTEGER DEFAULT 1,
    notes       TEXT
);
"""


@contextmanager
def session():
    """Open a connection, commit on success, and ALWAYS close it.

    `with sqlite3.connect(...) as conn` commits but does NOT close — a detail
    that previously leaked a file handle on every single query. Hundreds of
    live handles against one file is how the database ended up with a corrupt
    page-1 header.

    WAL journalling is enabled because it survives an abrupt process exit far
    better than the rollback journal, which matters when the server is killed
    mid-write during development.
    """
    with _lock:
        conn = sqlite3.connect(cfg.DB_PATH, check_same_thread=False, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.execute("PRAGMA foreign_keys = ON")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _quarantine_unreadable() -> str | None:
    """Move an unreadable database aside so the app can start with a fresh one.

    Refusing to start at all would take the whole tool down over a cache of
    past scans. The old file is renamed rather than deleted, so nothing is
    silently destroyed and it can still be examined.
    """
    if not cfg.DB_PATH.exists():
        return None

    conn = None
    try:
        conn = sqlite3.connect(cfg.DB_PATH, timeout=5)
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        return None
    except sqlite3.DatabaseError:
        pass
    finally:
        # Closed in `finally`, not after the query: if the probe raises, an
        # unclosed handle keeps the file locked, and on Windows the rename
        # below then fails with PermissionError.
        if conn is not None:
            conn.close()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    broken = cfg.DB_PATH.with_name(f"{cfg.DB_PATH.stem}.corrupt-{stamp}.db")
    try:
        shutil.move(str(cfg.DB_PATH), str(broken))
    except OSError as exc:
        # Another process still holds it. Starting with a broken database is
        # worse than saying so, so this is raised rather than swallowed.
        raise RuntimeError(
            f"The database at {cfg.DB_PATH} is unreadable and could not be "
            f"moved aside ({exc}). Close any other running copy of the server "
            f"and start again."
        ) from exc

    for suffix in ("-wal", "-shm"):
        cfg.DB_PATH.with_name(cfg.DB_PATH.name + suffix).unlink(missing_ok=True)
    return broken.name


def init() -> str | None:
    """Create the schema. Returns the quarantined filename if one was moved."""
    moved = _quarantine_unreadable()
    with session() as conn:
        conn.executescript(_SCHEMA)
    return moved


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------------ scans
def save_scan(report: dict) -> None:
    """Persist a report. The face embeddings are stripped - they are large and
    only meaningful during the request that produced them."""
    slim = json.loads(json.dumps(report, default=str))
    for face in slim.get("faces", []):
        face.pop("_embedding", None)

    with session() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO scans
               (scan_id, created_at, filename, media_type, verdict, risk_level,
                fake_probability, authenticity_score, confidence, faces_detected,
                file_size_bytes, processing_ms, report_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                report["scan_id"], _now(), report["filename"], report["media_type"],
                report["verdict"], report.get("risk_level"),
                report["fake_probability"], report["authenticity_score"],
                report.get("confidence"),
                report.get("faces_detected", report.get("people_detected", 0)),
                report.get("file_size_bytes"), report.get("processing_ms"),
                json.dumps(slim, default=str),
            ),
        )


def recent_scans(limit: int = 20, offset: int = 0,
                 verdict: str | None = None) -> list[dict]:
    query = ("SELECT scan_id, created_at, filename, media_type, verdict, risk_level,"
             " fake_probability, authenticity_score, confidence, faces_detected,"
             " file_size_bytes, processing_ms FROM scans")
    params: list = []
    if verdict:
        query += " WHERE verdict = ?"
        params.append(verdict.upper())
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    with session() as conn:
        return [dict(r) for r in conn.execute(query, params).fetchall()]


def get_scan(scan_id: str) -> dict | None:
    with session() as conn:
        row = conn.execute(
            "SELECT report_json FROM scans WHERE scan_id = ?", (scan_id,)
        ).fetchone()
    return json.loads(row["report_json"]) if row else None


def delete_scan(scan_id: str) -> bool:
    with session() as conn:
        return conn.execute("DELETE FROM scans WHERE scan_id = ?", (scan_id,)).rowcount > 0


def stats() -> dict:
    """Aggregates that drive the dashboard tiles and the donut chart."""
    with session() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM scans").fetchone()["c"]
        by_verdict = {
            r["verdict"]: r["c"]
            for r in conn.execute(
                "SELECT verdict, COUNT(*) c FROM scans GROUP BY verdict"
            ).fetchall()
        }
        by_type = {
            r["media_type"]: r["c"]
            for r in conn.execute(
                "SELECT media_type, COUNT(*) c FROM scans GROUP BY media_type"
            ).fetchall()
        }
        avg_ms = conn.execute(
            "SELECT AVG(processing_ms) a FROM scans"
        ).fetchone()["a"] or 0.0
        trend = [
            dict(r) for r in conn.execute(
                """SELECT substr(created_at, 1, 10) day,
                          COUNT(*) total,
                          SUM(CASE WHEN verdict='FAKE' THEN 1 ELSE 0 END) fake
                   FROM scans GROUP BY day ORDER BY day DESC LIMIT 14"""
            ).fetchall()
        ]

    authentic = by_verdict.get("AUTHENTIC", 0)
    suspicious = by_verdict.get("SUSPICIOUS", 0)
    fake = by_verdict.get("FAKE", 0)
    pct = lambda n: round(n / total * 100, 1) if total else 0.0

    return {
        "total_scans": total,
        "authentic": authentic,
        "suspicious": suspicious,
        "fake": fake,
        "authentic_pct": pct(authentic),
        "suspicious_pct": pct(suspicious),
        "fake_pct": pct(fake),
        "by_media_type": by_type,
        "avg_processing_ms": round(avg_ms, 1),
        "trend": list(reversed(trend)),
    }


# ------------------------------------------------------------------- identities
def enroll_identity(name: str, embedding: np.ndarray, notes: str | None = None) -> dict:
    """Add or update a known face. Re-enrolling averages the embeddings, which
    makes the identity more robust across pose and lighting."""
    vec = np.asarray(embedding, dtype=np.float32)

    with session() as conn:
        row = conn.execute(
            "SELECT embedding, sample_count FROM identities WHERE name = ?", (name,)
        ).fetchone()

        if row:
            existing = np.frombuffer(row["embedding"], dtype=np.float32)
            n = row["sample_count"]
            vec = (existing * n + vec) / (n + 1)
            count = n + 1
        else:
            count = 1

        conn.execute(
            """INSERT OR REPLACE INTO identities (name, created_at, embedding, sample_count, notes)
               VALUES (?,?,?,?,?)""",
            (name, _now(), vec.astype(np.float32).tobytes(), count, notes),
        )

    return {"name": name, "sample_count": count, "dimensions": int(vec.size)}


def load_gallery() -> dict[str, np.ndarray]:
    with session() as conn:
        rows = conn.execute("SELECT name, embedding FROM identities").fetchall()
    return {r["name"]: np.frombuffer(r["embedding"], dtype=np.float32) for r in rows}


def list_identities() -> list[dict]:
    with session() as conn:
        return [
            dict(r) for r in conn.execute(
                "SELECT name, created_at, sample_count, notes FROM identities ORDER BY name"
            ).fetchall()
        ]


def delete_identity(name: str) -> bool:
    with session() as conn:
        return conn.execute("DELETE FROM identities WHERE name = ?", (name,)).rowcount > 0
