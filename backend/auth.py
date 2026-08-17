"""Local account storage: sign-up, sign-in, sessions.

Scope, stated plainly: this is real authentication for a locally-run tool, not a
production identity system. Passwords are hashed with scrypt and a per-user salt
(never stored or logged in plaintext), sessions are opaque random tokens with an
expiry, and everything lives in the same SQLite file as the rest of the app.

What it deliberately does NOT do: email verification, password reset, rate
limiting beyond a simple attempt counter, OAuth, or 2FA. Do not put this on the
public internet as-is.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import config as cfg
from database import session

# The lock lives in database.py and is shared, so account writes and scan
# writes serialise against each other rather than racing.

# scrypt parameters. n=2**14 keeps sign-in near ~100 ms on the 2-core CPU this
# runs on — slow enough to be costly to brute force, fast enough to feel instant.
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_KEY_LEN = 64
_SALT_BYTES = 16

SESSION_DAYS = 14
MIN_PASSWORD = 8
MAX_PASSWORD = 200          # scrypt on an unbounded string is a DoS vector
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    salt        BLOB NOT NULL,
    password_hash BLOB NOT NULL,
    created_at  TEXT NOT NULL,
    last_login  TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
"""


class AuthError(Exception):
    """Raised for anything the caller should see as a 4xx."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def init() -> None:
    with session() as conn:
        conn.executescript(_SCHEMA)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_KEY_LEN,
    )


# ---------------------------------------------------------------- validation
def _clean_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise AuthError("That does not look like a valid email address.", 422)
    if len(email) > 254:
        raise AuthError("That email address is too long.", 422)
    return email


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if len(name) < 2:
        raise AuthError("Please enter your name (at least 2 characters).", 422)
    if len(name) > 80:
        raise AuthError("That name is too long.", 422)
    return name


def _check_password(password: str) -> str:
    if not password or len(password) < MIN_PASSWORD:
        raise AuthError(f"Password must be at least {MIN_PASSWORD} characters.", 422)
    if len(password) > MAX_PASSWORD:
        raise AuthError(f"Password must be under {MAX_PASSWORD} characters.", 422)
    if password.isdigit() or password.isalpha():
        raise AuthError("Use a mix of letters and numbers.", 422)
    return password


# --------------------------------------------------------------------- users
def sign_up(email: str, name: str, password: str) -> dict:
    email = _clean_email(email)
    name = _clean_name(name)
    _check_password(password)

    salt = os.urandom(_SALT_BYTES)
    digest = _hash_password(password, salt)

    with session() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise AuthError("An account with that email already exists.", 409)

        cur = conn.execute(
            """INSERT INTO users (email, name, salt, password_hash, created_at)
               VALUES (?,?,?,?,?)""",
            (email, name, salt, digest, _iso(_now())),
        )
        user_id = cur.lastrowid

    return _issue_session(user_id, email, name)


def sign_in(email: str, password: str) -> dict:
    email = _clean_email(email)

    with session() as conn:
        row = conn.execute(
            "SELECT id, email, name, salt, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    # Hash even when the user does not exist, so a missing account and a wrong
    # password take the same time and cannot be told apart by timing.
    salt = row["salt"] if row else os.urandom(_SALT_BYTES)
    expected = row["password_hash"] if row else os.urandom(_KEY_LEN)
    candidate = _hash_password(password or "", salt)

    if not row or not hmac.compare_digest(candidate, expected):
        raise AuthError("Incorrect email or password.", 401)

    with session() as conn:
        conn.execute("UPDATE users SET last_login = ? WHERE id = ?",
                     (_iso(_now()), row["id"]))

    return _issue_session(row["id"], row["email"], row["name"])


def _issue_session(user_id: int, email: str, name: str) -> dict:
    token = secrets.token_urlsafe(32)
    now = _now()
    expires = now + timedelta(days=SESSION_DAYS)

    with session() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, user_id, _iso(now), _iso(expires)),
        )

    return {
        "token": token,
        "expires_at": _iso(expires),
        "user": {"id": user_id, "email": email, "name": name},
    }


def current_user(token: str | None) -> dict | None:
    """Resolve a session token, or None if missing, unknown or expired."""
    if not token:
        return None

    with session() as conn:
        row = conn.execute(
            """SELECT s.expires_at, u.id, u.email, u.name, u.created_at
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token = ?""",
            (token,),
        ).fetchone()

    if not row:
        return None

    if datetime.fromisoformat(row["expires_at"]) < _now():
        sign_out(token)
        return None

    return {
        "id": row["id"], "email": row["email"],
        "name": row["name"], "created_at": row["created_at"],
    }


def sign_out(token: str | None) -> bool:
    if not token:
        return False
    with session() as conn:
        return conn.execute("DELETE FROM sessions WHERE token = ?", (token,)).rowcount > 0


def purge_expired() -> int:
    with session() as conn:
        return conn.execute("DELETE FROM sessions WHERE expires_at < ?",
                            (_iso(_now()),)).rowcount


def user_count() -> int:
    with session() as conn:
        return conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
