"""Regression tests for the database session helper.

These exist because of a real corruption incident: every query used
`with sqlite3.connect(...) as conn`, which commits but does NOT close. Hundreds
of live handles against one file left the database with an invalid page-1
B-tree header, and the whole app started returning 500s.
"""

from __future__ import annotations

import sqlite3
import threading

import numpy as np
import pytest

import auth
import database as db


class TestSessionClosesConnections:
    def test_connection_is_closed_on_success(self, monkeypatch):
        opened = []
        real_connect = sqlite3.connect

        def tracking_connect(*a, **kw):
            conn = real_connect(*a, **kw)
            opened.append(conn)
            return conn

        monkeypatch.setattr(sqlite3, "connect", tracking_connect)

        with db.session() as conn:
            conn.execute("SELECT 1")

        assert len(opened) == 1
        with pytest.raises(sqlite3.ProgrammingError):
            opened[0].execute("SELECT 1")      # closed connections raise

    def test_connection_is_closed_when_the_body_raises(self, monkeypatch):
        opened = []
        real_connect = sqlite3.connect
        monkeypatch.setattr(sqlite3, "connect",
                            lambda *a, **kw: opened.append(real_connect(*a, **kw)) or opened[-1])

        with pytest.raises(ValueError):
            with db.session():
                raise ValueError("boom")

        with pytest.raises(sqlite3.ProgrammingError):
            opened[0].execute("SELECT 1")

    def test_many_operations_leak_nothing(self, monkeypatch):
        """The actual failure mode: handles accumulating across many calls.

        `Connection.close` is read-only so it cannot be wrapped; instead every
        connection handed out is collected and probed at the end. A still-open
        connection answers the query; a closed one raises ProgrammingError.
        """
        opened = []
        real_connect = sqlite3.connect

        def tracking_connect(*a, **kw):
            conn = real_connect(*a, **kw)
            opened.append(conn)
            return conn

        monkeypatch.setattr(sqlite3, "connect", tracking_connect)

        for i in range(40):
            db.save_scan({
                "scan_id": f"LEAK{i}", "media_type": "image", "filename": f"{i}.jpg",
                "verdict": "AUTHENTIC", "risk_level": "MINIMAL", "fake_probability": 0.1,
                "authenticity_score": 90.0, "confidence": 0.8, "faces_detected": 1,
                "file_size_bytes": 10, "processing_ms": 1.0, "faces": [],
            })
            db.stats()
            db.recent_scans(limit=5)

        assert len(opened) >= 120, "expected one connection per operation"

        still_open = []
        for conn in opened:
            try:
                conn.execute("SELECT 1")
                still_open.append(conn)
            except sqlite3.ProgrammingError:
                pass          # closed, as it should be

        assert still_open == [], (
            f"{len(still_open)} of {len(opened)} connections left open — "
            f"this is the leak that corrupted the database"
        )

    def test_rollback_on_error_leaves_no_partial_write(self):
        db.save_scan({
            "scan_id": "ROLLBACK1", "media_type": "image", "filename": "a.jpg",
            "verdict": "FAKE", "risk_level": "HIGH", "fake_probability": 0.9,
            "authenticity_score": 10.0, "confidence": 0.8, "faces_detected": 1,
            "file_size_bytes": 10, "processing_ms": 1.0, "faces": [],
        })
        with pytest.raises(sqlite3.OperationalError):
            with db.session() as conn:
                conn.execute("DELETE FROM scans")
                conn.execute("SELECT * FROM a_table_that_does_not_exist")

        assert db.get_scan("ROLLBACK1") is not None, "delete should have rolled back"


class TestSharedLock:
    def test_auth_and_scans_use_the_same_lock(self):
        """Two independent locks over one file is not serialisation."""
        import inspect
        source = inspect.getsource(auth)
        assert "threading.Lock()" not in source, "auth must not hold its own lock"
        assert "from database import session" in source

    def test_concurrent_writes_from_both_modules(self):
        """Scans and accounts written from several threads at once must all
        land, and the database must stay readable."""
        errors = []

        def write_scans(start):
            try:
                for i in range(start, start + 15):
                    db.save_scan({
                        "scan_id": f"T{i}", "media_type": "image", "filename": f"{i}.jpg",
                        "verdict": "AUTHENTIC", "risk_level": "MINIMAL",
                        "fake_probability": 0.1, "authenticity_score": 90.0,
                        "confidence": 0.8, "faces_detected": 1,
                        "file_size_bytes": 10, "processing_ms": 1.0, "faces": [],
                    })
            except Exception as exc:                       # noqa: BLE001
                errors.append(exc)

        def write_identities(start):
            try:
                for i in range(start, start + 15):
                    db.enroll_identity(f"person{i}", np.ones(128, dtype=np.float32))
            except Exception as exc:                       # noqa: BLE001
                errors.append(exc)

        threads = [
            threading.Thread(target=write_scans, args=(0,)),
            threading.Thread(target=write_scans, args=(100,)),
            threading.Thread(target=write_identities, args=(0,)),
            threading.Thread(target=write_identities, args=(100,)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        assert errors == [], f"concurrent writes raised: {errors}"
        assert db.stats()["total_scans"] == 30
        assert len(db.list_identities()) == 30

        with db.session() as conn:
            assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


class TestCorruptionRecovery:
    def test_unreadable_database_is_moved_aside(self, tmp_path, monkeypatch):
        broken = tmp_path / "omniguard.db"
        broken.write_bytes(b"SQLite format 3\x00" + b"\x00garbage" * 200)
        monkeypatch.setattr(db.cfg, "DB_PATH", broken)

        moved = db.init()

        assert moved is not None and "corrupt" in moved
        assert (tmp_path / moved).exists(), "the damaged file must be kept, not deleted"
        # A fresh, usable database now sits at the original path.
        assert db.stats()["total_scans"] == 0

    def test_healthy_database_is_left_alone(self, tmp_path, monkeypatch):
        path = tmp_path / "omniguard.db"
        monkeypatch.setattr(db.cfg, "DB_PATH", path)
        db.init()
        assert db.init() is None, "a healthy database must not be quarantined"

    def test_wal_mode_is_enabled(self):
        with db.session() as conn:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
