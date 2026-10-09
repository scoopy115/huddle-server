"""Dashboard accounts: e-mail + password (argon2id), optional TOTP second factor, server-side
sessions in an HttpOnly cookie. Login attempts are throttled per e-mail and per address."""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from .db import ServerDB

_ph = PasswordHasher()
COOKIE = "huddle_session"
MAX_ATTEMPTS = 8          # per 15 minutes, per e-mail and per client address
WINDOW = 15 * 60


class AuthError(Exception):
    pass


@dataclass
class User:
    id: int
    email: str
    totp_enabled: bool
    created_at: float


@dataclass
class Session:
    id: str
    user: User
    totp_ok: bool
    expires_at: float


class Throttle:
    def __init__(self):
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, *keys: str) -> None:
        now = time.time()
        with self._lock:
            for k in keys:
                hits = [t for t in self._hits.get(k, []) if now - t < WINDOW]
                self._hits[k] = hits
                if len(hits) >= MAX_ATTEMPTS:
                    raise AuthError("Too many attempts. Try again in a few minutes.")

    def hit(self, *keys: str) -> None:
        now = time.time()
        with self._lock:
            for k in keys:
                self._hits.setdefault(k, []).append(now)


throttle = Throttle()


def _user(r) -> User:
    return User(id=r["id"], email=r["email"], totp_enabled=bool(r["totp_enabled"]), created_at=r["created_at"])


def user_count(db: ServerDB) -> int:
    return int(db.one("SELECT COUNT(*) AS n FROM users")["n"])


def create_user(db: ServerDB, email: str, password: str) -> User:
    email = email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise AuthError("Enter a valid e-mail address.")
    if len(password) < 10:
        raise AuthError("Use a password of at least 10 characters.")
    if db.one("SELECT 1 FROM users WHERE email = ?", (email,)):
        raise AuthError("An account with this e-mail address exists.")
    cur = db.execute("INSERT INTO users(email, password_hash, created_at) VALUES (?,?,?)", (email, _ph.hash(password), time.time()))
    return _user(db.one("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)))


def verify_password(db: ServerDB, email: str, password: str, address: str = "") -> User:
    email = email.strip().lower()
    throttle.check(f"email:{email}", f"addr:{address}")
    r = db.one("SELECT * FROM users WHERE email = ?", (email,))
    try:
        if not r:
            raise VerifyMismatchError()
        _ph.verify(r["password_hash"], password)
    except VerifyMismatchError:
        throttle.hit(f"email:{email}", f"addr:{address}")
        raise AuthError("Wrong e-mail address or password.") from None
    if _ph.check_needs_rehash(r["password_hash"]):
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (_ph.hash(password), r["id"]))
    return _user(r)


def change_password(db: ServerDB, user_id: int, current: str, new: str) -> None:
    r = db.one("SELECT * FROM users WHERE id = ?", (user_id,))
    try:
        _ph.verify(r["password_hash"], current)
    except VerifyMismatchError:
        raise AuthError("The current password is wrong.") from None
    if len(new) < 10:
        raise AuthError("Use a password of at least 10 characters.")
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (_ph.hash(new), user_id))
    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


# ---- sessions --------------------------------------------------------------- #
def create_session(db: ServerDB, user: User, hours: int, user_agent: str | None = None) -> Session:
    sid = secrets.token_urlsafe(32)
    now = time.time()
    db.execute("INSERT INTO sessions(id, user_id, created_at, last_seen, expires_at, totp_ok, user_agent) VALUES (?,?,?,?,?,?,?)",
               (sid, user.id, now, now, now + hours * 3600, 0 if user.totp_enabled else 1, (user_agent or "")[:200]))
    return Session(id=sid, user=user, totp_ok=not user.totp_enabled, expires_at=now + hours * 3600)


def get_session(db: ServerDB, sid: str | None, hours: int) -> Session | None:
    if not sid:
        return None
    r = db.one("SELECT s.*, u.email, u.totp_enabled, u.created_at AS u_created FROM sessions s JOIN users u ON u.id = s.user_id"
               " WHERE s.id = ?", (sid,))
    now = time.time()
    if not r or r["expires_at"] < now:
        if r:
            db.execute("DELETE FROM sessions WHERE id = ?", (sid,))
        return None
    if now - r["last_seen"] > 60:   # sliding expiry, written at most once a minute
        db.execute("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?", (now, now + hours * 3600, sid))
    user = User(id=r["user_id"], email=r["email"], totp_enabled=bool(r["totp_enabled"]), created_at=r["u_created"])
    return Session(id=sid, user=user, totp_ok=bool(r["totp_ok"]), expires_at=r["expires_at"])


def delete_session(db: ServerDB, sid: str) -> None:
    db.execute("DELETE FROM sessions WHERE id = ?", (sid,))


def purge_sessions(db: ServerDB) -> None:
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))


# ---- TOTP ------------------------------------------------------------------- #
def totp_setup(db: ServerDB, user: User, issuer: str) -> dict:
    """Start enrolment: a fresh secret (not active until a code is confirmed)."""
    secret = pyotp.random_base32()
    db.execute("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?", (secret, user.id))
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=issuer)
    return {"secret": secret, "uri": uri, "svg": _qr_svg(uri)}


def totp_enable(db: ServerDB, user: User, code: str) -> None:
    r = db.one("SELECT totp_secret FROM users WHERE id = ?", (user.id,))
    if not r or not r["totp_secret"]:
        raise AuthError("Start the setup first.")
    if not pyotp.TOTP(r["totp_secret"]).verify(code.strip().replace(" ", ""), valid_window=1):
        raise AuthError("That code is not valid. Check the time on your phone and try again.")
    db.execute("UPDATE users SET totp_enabled = 1 WHERE id = ?", (user.id,))
    db.execute("UPDATE sessions SET totp_ok = 1 WHERE user_id = ?", (user.id,))


def totp_disable(db: ServerDB, user: User, code: str) -> None:
    totp_check(db, user, code)
    db.execute("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", (user.id,))


def totp_check(db: ServerDB, user: User, code: str, address: str = "") -> None:
    throttle.check(f"totp:{user.id}", f"addr:{address}")
    r = db.one("SELECT totp_secret FROM users WHERE id = ?", (user.id,))
    if not r or not r["totp_secret"] or not pyotp.TOTP(r["totp_secret"]).verify(code.strip().replace(" ", ""), valid_window=1):
        throttle.hit(f"totp:{user.id}", f"addr:{address}")
        raise AuthError("That code is not valid.")


def totp_confirm_session(db: ServerDB, session: Session, code: str, address: str = "") -> None:
    totp_check(db, session.user, code, address)
    db.execute("UPDATE sessions SET totp_ok = 1 WHERE id = ?", (session.id,))


def _qr_svg(data: str) -> str:
    import qrcode
    import qrcode.image.svg
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    return img.to_string(encoding="unicode")
