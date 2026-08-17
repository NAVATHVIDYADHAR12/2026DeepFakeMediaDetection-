"""Account and session tests.

Security-relevant behaviour is asserted explicitly — password hashing, timing
equivalence between unknown-user and wrong-password, session expiry, and that
hashes never leak through the API.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import auth
import main
from database import session


@pytest.fixture(autouse=True)
def _auth_tables(temp_db):
    auth.init()
    yield


@pytest.fixture
def client():
    with TestClient(main.app) as c:
        yield c


GOOD = {"email": "Ada@Example.com", "name": "Ada Lovelace", "password": "analytical1engine"}


# ------------------------------------------------------------------- sign up
class TestSignUp:
    def test_creates_an_account(self):
        result = auth.sign_up(**GOOD)
        assert result["user"]["email"] == "ada@example.com"   # normalised
        assert result["user"]["name"] == "Ada Lovelace"
        assert len(result["token"]) > 30

    def test_password_is_never_stored_in_plaintext(self):
        auth.sign_up(**GOOD)
        with session() as conn:
            row = conn.execute("SELECT salt, password_hash FROM users").fetchone()
        assert GOOD["password"].encode() not in bytes(row["password_hash"])
        assert len(row["salt"]) == 16
        assert len(row["password_hash"]) == 64

    def test_same_password_yields_different_hashes(self):
        auth.sign_up(**GOOD)
        auth.sign_up(email="b@example.com", name="Bee", password=GOOD["password"])
        with session() as conn:
            hashes = [bytes(r["password_hash"]) for r in
                      conn.execute("SELECT password_hash FROM users").fetchall()]
        assert hashes[0] != hashes[1], "per-user salt is not being applied"

    def test_duplicate_email_rejected(self):
        auth.sign_up(**GOOD)
        with pytest.raises(auth.AuthError) as e:
            auth.sign_up(**GOOD)
        assert e.value.status == 409

    def test_duplicate_detection_is_case_insensitive(self):
        auth.sign_up(**GOOD)
        with pytest.raises(auth.AuthError):
            auth.sign_up(email="ADA@EXAMPLE.COM", name="Other", password="another1pass")

    @pytest.mark.parametrize("email", ["", "nope", "a@b", "a b@c.com", "@example.com"])
    def test_invalid_emails_rejected(self, email):
        with pytest.raises(auth.AuthError):
            auth.sign_up(email=email, name="Ada", password="analytical1engine")

    @pytest.mark.parametrize("password", ["", "short1", "alllettersonly", "12345678901"])
    def test_weak_passwords_rejected(self, password):
        with pytest.raises(auth.AuthError):
            auth.sign_up(email="x@example.com", name="Ada", password=password)

    def test_absurdly_long_password_rejected(self):
        # Unbounded input into scrypt is a denial-of-service vector.
        with pytest.raises(auth.AuthError):
            auth.sign_up(email="x@example.com", name="Ada", password="a1" * 200)

    @pytest.mark.parametrize("name", ["", " ", "a"])
    def test_short_names_rejected(self, name):
        with pytest.raises(auth.AuthError):
            auth.sign_up(email="x@example.com", name=name, password="analytical1engine")


# ------------------------------------------------------------------- sign in
class TestSignIn:
    def test_correct_credentials(self):
        auth.sign_up(**GOOD)
        result = auth.sign_in(GOOD["email"], GOOD["password"])
        assert result["user"]["email"] == "ada@example.com"

    def test_email_case_insensitive(self):
        auth.sign_up(**GOOD)
        assert auth.sign_in("ADA@example.COM", GOOD["password"])["user"]["id"]

    def test_wrong_password_rejected(self):
        auth.sign_up(**GOOD)
        with pytest.raises(auth.AuthError) as e:
            auth.sign_in(GOOD["email"], "wrongpassword1")
        assert e.value.status == 401

    def test_unknown_user_rejected(self):
        with pytest.raises(auth.AuthError) as e:
            auth.sign_in("nobody@example.com", "whatever123")
        assert e.value.status == 401

    def test_error_text_does_not_reveal_which_field_was_wrong(self):
        auth.sign_up(**GOOD)
        with pytest.raises(auth.AuthError) as wrong_pw:
            auth.sign_in(GOOD["email"], "wrongpassword1")
        with pytest.raises(auth.AuthError) as no_user:
            auth.sign_in("ghost@example.com", "wrongpassword1")
        assert str(wrong_pw.value) == str(no_user.value)

    def test_unknown_user_still_costs_time(self):
        """Skipping the hash for unknown users would let an attacker enumerate
        accounts by timing. Both paths must hash."""
        auth.sign_up(**GOOD)

        t0 = time.perf_counter()
        with pytest.raises(auth.AuthError):
            auth.sign_in("ghost@example.com", "wrongpassword1")
        missing = time.perf_counter() - t0

        t0 = time.perf_counter()
        with pytest.raises(auth.AuthError):
            auth.sign_in(GOOD["email"], "wrongpassword1")
        wrong = time.perf_counter() - t0

        # Generous bound — this catches "returns instantly", not microseconds.
        assert missing > wrong * 0.25, f"missing={missing:.3f}s wrong={wrong:.3f}s"

    def test_last_login_is_recorded(self):
        auth.sign_up(**GOOD)
        auth.sign_in(GOOD["email"], GOOD["password"])
        with session() as conn:
            assert conn.execute("SELECT last_login FROM users").fetchone()["last_login"]


# ------------------------------------------------------------------ sessions
class TestSessions:
    def test_token_resolves_to_user(self):
        token = auth.sign_up(**GOOD)["token"]
        user = auth.current_user(token)
        assert user["email"] == "ada@example.com"

    def test_tokens_are_unique(self):
        auth.sign_up(**GOOD)
        a = auth.sign_in(GOOD["email"], GOOD["password"])["token"]
        b = auth.sign_in(GOOD["email"], GOOD["password"])["token"]
        assert a != b

    def test_unknown_token_returns_none(self):
        assert auth.current_user("not-a-real-token") is None

    def test_missing_token_returns_none(self):
        assert auth.current_user(None) is None
        assert auth.current_user("") is None

    def test_sign_out_invalidates(self):
        token = auth.sign_up(**GOOD)["token"]
        assert auth.sign_out(token) is True
        assert auth.current_user(token) is None

    def test_expired_session_is_rejected_and_cleaned_up(self):
        token = auth.sign_up(**GOOD)["token"]
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        with session() as conn:
            conn.execute("UPDATE sessions SET expires_at = ? WHERE token = ?", (past, token))

        assert auth.current_user(token) is None
        with session() as conn:
            assert conn.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"] == 0

    def test_purge_expired(self):
        token = auth.sign_up(**GOOD)["token"]
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        with session() as conn:
            conn.execute("UPDATE sessions SET expires_at = ? WHERE token = ?", (past, token))
        assert auth.purge_expired() == 1


# ----------------------------------------------------------------- endpoints
class TestAuthEndpoints:
    def test_signup_login_me_logout_cycle(self, client):
        r = client.post("/api/auth/signup", data=GOOD)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == "ada@example.com"

        me = client.get("/api/auth/me").json()
        assert me["authenticated"] is True
        assert me["user"]["name"] == "Ada Lovelace"

        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").json()["authenticated"] is False

        r = client.post("/api/auth/login",
                        data={"email": GOOD["email"], "password": GOOD["password"]})
        assert r.status_code == 200
        assert client.get("/api/auth/me").json()["authenticated"] is True

    def test_session_cookie_is_httponly(self, client):
        r = client.post("/api/auth/signup",
                        data={**GOOD, "email": "cookie@example.com"})
        header = r.headers.get("set-cookie", "")
        assert "omniguard_session" in header
        assert "HttpOnly" in header, "token must be unreadable from JavaScript"

    def test_response_never_contains_the_hash_or_token_fields(self, client):
        body = client.post("/api/auth/signup",
                           data={**GOOD, "email": "leak@example.com"}).json()
        flat = str(body).lower()
        assert "password" not in flat
        assert "hash" not in flat
        assert "salt" not in flat

    def test_duplicate_signup_returns_409(self, client):
        client.post("/api/auth/signup", data={**GOOD, "email": "dup@example.com"})
        r = client.post("/api/auth/signup", data={**GOOD, "email": "dup@example.com"})
        assert r.status_code == 409

    def test_weak_password_returns_422(self, client):
        r = client.post("/api/auth/signup",
                        data={**GOOD, "email": "weak@example.com", "password": "abc"})
        assert r.status_code == 422

    def test_bad_login_returns_401(self, client):
        r = client.post("/api/auth/login",
                        data={"email": "ghost@example.com", "password": "nope12345"})
        assert r.status_code == 401

    def test_me_without_session(self, client):
        client.post("/api/auth/logout")
        assert client.get("/api/auth/me").json()["authenticated"] is False

    def test_scanning_does_not_require_an_account(self, client, face_image_path):
        """Auth is additive. The tool must keep working signed out."""
        client.post("/api/auth/logout")
        r = client.post("/api/scan/image",
                        files={"file": (face_image_path.name,
                                        face_image_path.read_bytes(), "image/jpeg")})
        assert r.status_code == 200
