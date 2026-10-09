"""Client keys: one key per device that sends recordings (a MacBook, later a phone). The key is
shown once; only its SHA-256 is stored. Revoking a client stops it immediately."""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from .db import ServerDB

PREFIX = "hsk_"


SCOPES = ("own", "all")


@dataclass
class Client:
    id: int
    name: str
    prefix: str
    created_at: float
    last_seen_at: float | None
    last_version: str | None
    revoked: bool
    user_id: int | None
    scope: str = "own"            # own = its own uploads; all = every recording on the server
    ai_enabled: bool = True       # the server writes notes for this client's recordings
    kind: str = "device"          # device (has a key) | browser (the dashboard's recorder)
    user_email: str | None = None
    meeting_count: int = 0
    token_count: int = 0
    key: str | None = None        # only right after creation

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "prefix": self.prefix, "createdAt": self.created_at,
                "lastSeenAt": self.last_seen_at, "lastVersion": self.last_version, "revoked": self.revoked,
                "userId": self.user_id, "userEmail": self.user_email, "scope": self.scope, "aiEnabled": self.ai_enabled, "kind": self.kind,
                "meetingCount": self.meeting_count, "tokenCount": self.token_count, "key": self.key}


_SQL = "SELECT c.*, u.email AS user_email FROM clients c LEFT JOIN users u ON u.id = c.user_id"


def _row(r, count: int = 0, tokens: int = 0) -> Client:
    keys = r.keys()
    return Client(id=r["id"], name=r["name"], prefix=r["prefix"], created_at=r["created_at"], last_seen_at=r["last_seen_at"],
                  last_version=r["last_version"], revoked=bool(r["revoked_at"]), user_id=r["user_id"],
                  scope=r["scope"] if r["scope"] in SCOPES else "own",
                  ai_enabled=bool(r["ai_enabled"]) if "ai_enabled" in keys else True,
                  kind=r["kind"] if "kind" in keys and r["kind"] else "device",
                  user_email=r["user_email"] if "user_email" in keys else None, meeting_count=count, token_count=tokens)


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create(db: ServerDB, name: str, user_id: int, scope: str = "own", kind: str = "device") -> Client:
    name = (name or "").strip()[:80] or "Client"
    key = PREFIX + secrets.token_urlsafe(32)
    cur = db.execute("INSERT INTO clients(name, key_hash, prefix, created_at, user_id, scope, kind) VALUES (?,?,?,?,?,?,?)",
                     (name, _hash(key), key[:12], time.time(), user_id, scope if scope in SCOPES else "own", kind))
    c = get(db, int(cur.lastrowid))
    assert c
    c.key = key if kind == "device" else None
    return c


def browser_client(db: ServerDB, user_id: int) -> Client:
    """The account's recorder in the dashboard: one client without a key, made on first use."""
    r = db.one(_SQL + " WHERE c.user_id = ? AND c.kind = 'browser' ORDER BY c.id LIMIT 1", (user_id,))
    return _row(r) if r else create(db, "Browser", user_id, kind="browser")


def get(db: ServerDB, client_id: int) -> Client | None:
    r = db.one(_SQL + " WHERE c.id = ?", (client_id,))
    return _row(r) if r else None


def list_clients(db: ServerDB, user_id: int | None = None) -> list[Client]:
    """All clients, or those of one account."""
    counts = {r["client_id"]: r["n"] for r in db.query("SELECT client_id, COUNT(*) AS n FROM uploads GROUP BY client_id")}
    tokens = {r["client_id"]: r["n"] for r in db.query("SELECT client_id, COUNT(*) AS n FROM mcp_tokens WHERE revoked_at IS NULL GROUP BY client_id")}
    rows = db.query(_SQL + " ORDER BY u.email, c.created_at") if user_id is None \
        else db.query(_SQL + " WHERE c.user_id = ? ORDER BY c.created_at", (user_id,))
    return [_row(r, counts.get(r["id"], 0), tokens.get(r["id"], 0)) for r in rows]


def rename(db: ServerDB, client_id: int, name: str) -> None:
    db.execute("UPDATE clients SET name = ? WHERE id = ?", ((name or "").strip()[:80] or "Client", client_id))


def set_ai(db: ServerDB, client_id: int, enabled: bool) -> None:
    db.execute("UPDATE clients SET ai_enabled = ? WHERE id = ?", (1 if enabled else 0, client_id))


def set_scope(db: ServerDB, client_id: int, scope: str) -> None:
    if scope not in SCOPES:
        raise ValueError(f"Unknown scope '{scope}'")
    db.execute("UPDATE clients SET scope = ? WHERE id = ?", (scope, client_id))


def revoke(db: ServerDB, client_id: int) -> None:
    """Revoking a client also revokes every MCP token made for it."""
    now = time.time()
    db.execute("UPDATE clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (now, client_id))
    db.execute("UPDATE mcp_tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL", (now, client_id))


def delete(db: ServerDB, client_id: int) -> None:
    db.execute("DELETE FROM clients WHERE id = ?", (client_id,))


def verify(db: ServerDB, key: str | None, version: str | None = None) -> Client | None:
    if not key or not key.startswith(PREFIX):
        return None
    r = db.one(_SQL + " WHERE c.key_hash = ? AND c.revoked_at IS NULL", (_hash(key),))
    if not r:
        return None
    db.execute("UPDATE clients SET last_seen_at = ?, last_version = COALESCE(?, last_version) WHERE id = ?",
               (time.time(), version, r["id"]))
    return _row(r)


def owns(db: ServerDB, client_id: int, meeting_id: str) -> bool:
    return bool(db.one("SELECT 1 FROM uploads WHERE meeting_id = ? AND client_id = ?", (meeting_id, client_id)))


def owner_user_of_meeting(db: ServerDB, meeting_id: str) -> int | None:
    r = db.one("SELECT c.user_id FROM uploads u JOIN clients c ON c.id = u.client_id WHERE u.meeting_id = ?", (meeting_id,))
    return r["user_id"] if r else None


def record_upload(db: ServerDB, client_id: int, meeting_id: str, nbytes: int) -> None:
    db.execute("INSERT INTO uploads(meeting_id, client_id, created_at, bytes) VALUES (?,?,?,?)"
               " ON CONFLICT(meeting_id) DO UPDATE SET bytes = excluded.bytes", (meeting_id, client_id, time.time(), nbytes))
