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


ROLES = ("admin", "user")
INVITE_DAYS = 7


@dataclass
class User:
    id: int
    email: str
    totp_enabled: bool
    created_at: float
    role: str = "user"
    approved: bool = True
    name: str = ""

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def public(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name, "totpEnabled": self.totp_enabled, "role": self.role,
                "approved": self.approved, "createdAt": self.created_at}


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
    return User(id=r["id"], email=r["email"], totp_enabled=bool(r["totp_enabled"]), created_at=r["created_at"],
                role=r["role"] if r["role"] in ROLES else "user", approved=bool(r["approved"]), name=r["name"] or "")


def user_count(db: ServerDB) -> int:
    return int(db.one("SELECT COUNT(*) AS n FROM users")["n"])


def list_users(db: ServerDB) -> list[User]:
    return [_user(r) for r in db.query("SELECT * FROM users ORDER BY created_at")]


def get_user(db: ServerDB, user_id: int) -> User | None:
    r = db.one("SELECT * FROM users WHERE id = ?", (user_id,))
    return _user(r) if r else None


EMAIL_RE = __import__("re").compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def valid_email(email: str) -> bool:
    e = (email or "").strip().lower()
    return 5 <= len(e) <= 254 and bool(EMAIL_RE.match(e))


def create_user(db: ServerDB, email: str, password: str, role: str = "user", approved: bool = True, name: str = "") -> User:
    email = email.strip().lower()
    if not valid_email(email):
        raise AuthError("Enter a valid e-mail address.")
    name = " ".join((name or "").split())[:80]
    if not name:
        raise AuthError("Enter a name.")
    if len(password) < 10:
        raise AuthError("Use a password of at least 10 characters.")
    if db.one("SELECT 1 FROM users WHERE email = ?", (email,)):
        raise AuthError("An account with this e-mail address exists.")
    cur = db.execute("INSERT INTO users(email, password_hash, created_at, role, approved, name) VALUES (?,?,?,?,?,?)",
                     (email, _ph.hash(password), time.time(), role if role in ROLES else "user", 1 if approved else 0, name))
    return _user(db.one("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)))


def set_name(db: ServerDB, user_id: int, name: str) -> None:
    name = " ".join((name or "").split())[:80]
    if not name:
        raise AuthError("Enter a name.")
    db.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))


def set_role(db: ServerDB, user_id: int, role: str) -> None:
    if role not in ROLES:
        raise AuthError("Unknown role.")
    if role != "admin" and int(db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ?", (user_id,))["n"]) == 0:
        raise AuthError("The server needs at least one admin.")
    db.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))


def approve(db: ServerDB, user_id: int) -> None:
    db.execute("UPDATE users SET approved = 1 WHERE id = ?", (user_id,))


def delete_user(db: ServerDB, user_id: int) -> None:
    r = db.one("SELECT role FROM users WHERE id = ?", (user_id,))
    if r and r["role"] == "admin" and int(db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")["n"]) <= 1:
        raise AuthError("The server needs at least one admin.")
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))


def admin_set_password(db: ServerDB, user_id: int, new: str) -> None:
    if len(new) < 10:
        raise AuthError("Use a password of at least 10 characters.")
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (_ph.hash(new), user_id))
    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


# ---- invites ------------------------------------------------------------------ #
def _hash(t: str) -> str:
    import hashlib
    return hashlib.sha256(t.encode()).hexdigest()


def create_invite(db: ServerDB, created_by: int, email: str | None = None) -> dict:
    email = (email or "").strip().lower() or None
    if email and not valid_email(email):
        raise AuthError("Enter a valid e-mail address.")
    token = secrets.token_urlsafe(24)
    now = time.time()
    cur = db.execute("INSERT INTO invites(token_hash, prefix, email, created_by, created_at, expires_at, token) VALUES (?,?,?,?,?,?,?)",
                     (_hash(token), token[:6], email, created_by, now, now + INVITE_DAYS * 86400, token))
    return {"id": cur.lastrowid, "token": token, "email": email, "expiresAt": now + INVITE_DAYS * 86400}


def list_invites(db: ServerDB) -> list[dict]:
    """Open invitations keep their token so the link can be copied again; used ones drop it."""
    return [{"id": r["id"], "prefix": r["prefix"], "email": r["email"], "createdAt": r["created_at"], "expiresAt": r["expires_at"],
             "used": bool(r["used_at"]), "expired": r["expires_at"] < time.time() and not r["used_at"],
             "token": r["token"] if not r["used_at"] and r["expires_at"] >= time.time() else None}
            for r in db.query("SELECT * FROM invites ORDER BY created_at DESC")]


def delete_invite(db: ServerDB, invite_id: int) -> None:
    db.execute("DELETE FROM invites WHERE id = ?", (invite_id,))


def check_invite(db: ServerDB, token: str) -> dict | None:
    r = db.one("SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", (_hash(token or ""), time.time()))
    return {"id": r["id"], "email": r["email"]} if r else None


def register(db: ServerDB, email: str, password: str, invite_token: str | None, open_registration: bool, address: str = "",
             name: str = "") -> User:
    """New account through an invite link (approved at once) or open registration (waits for an admin)."""
    throttle.check(f"register:{address}")
    throttle.hit(f"register:{address}")
    inv = check_invite(db, invite_token) if invite_token else None
    if invite_token and not inv:
        raise AuthError("This invitation is no longer valid.")
    if inv and inv["email"] and inv["email"] != email.strip().lower():
        raise AuthError("This invitation was made for another e-mail address.")
    if not inv and not open_registration:
        raise AuthError("Registration is by invitation only.")
    user = create_user(db, email, password, role="user", approved=bool(inv), name=name)
    if inv:
        db.execute("UPDATE invites SET used_at = ?, used_by = ?, token = NULL WHERE id = ?", (time.time(), user.id, inv["id"]))
    return user


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
    u = _user(r)
    if not u.approved:
        raise AuthError("Your account is waiting for approval by an admin.")
    return u


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
    r = db.one("SELECT s.*, u.email, u.name, u.totp_enabled, u.created_at AS u_created, u.role, u.approved FROM sessions s"
               " JOIN users u ON u.id = s.user_id WHERE s.id = ?", (sid,))
    now = time.time()
    if not r or r["expires_at"] < now or not r["approved"]:
        if r:
            db.execute("DELETE FROM sessions WHERE id = ?", (sid,))
        return None
    if now - r["last_seen"] > 60:   # sliding expiry, written at most once a minute
        db.execute("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?", (now, now + hours * 3600, sid))
    user = User(id=r["user_id"], email=r["email"], totp_enabled=bool(r["totp_enabled"]), created_at=r["u_created"],
                role=r["role"] if r["role"] in ROLES else "user", approved=True, name=r["name"] or "")
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
