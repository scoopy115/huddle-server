"""Client keys: one key per device that sends recordings (a MacBook, later a phone). The key is
shown once; only its SHA-256 is stored. Revoking a client stops it immediately."""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from .db import ServerDB

PREFIX = "hsk_"


@dataclass
class Client:
    id: int
    name: str
    prefix: str
    created_at: float
    last_seen_at: float | None
    last_version: str | None
    revoked: bool
    meeting_count: int = 0
    key: str | None = None        # only right after creation

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "prefix": self.prefix, "createdAt": self.created_at,
                "lastSeenAt": self.last_seen_at, "lastVersion": self.last_version, "revoked": self.revoked,
                "meetingCount": self.meeting_count, "key": self.key}


def _row(r, count: int = 0) -> Client:
    return Client(id=r["id"], name=r["name"], prefix=r["prefix"], created_at=r["created_at"], last_seen_at=r["last_seen_at"],
                  last_version=r["last_version"], revoked=bool(r["revoked_at"]), meeting_count=count)


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create(db: ServerDB, name: str) -> Client:
    name = (name or "").strip()[:80] or "Client"
    key = PREFIX + secrets.token_urlsafe(32)
    cur = db.execute("INSERT INTO clients(name, key_hash, prefix, created_at) VALUES (?,?,?,?)",
                     (name, _hash(key), key[:12], time.time()))
    c = _row(db.one("SELECT * FROM clients WHERE id = ?", (cur.lastrowid,)))
    c.key = key
    return c


def list_clients(db: ServerDB) -> list[Client]:
    counts = {r["client_id"]: r["n"] for r in db.query("SELECT client_id, COUNT(*) AS n FROM uploads GROUP BY client_id")}
    return [_row(r, counts.get(r["id"], 0)) for r in db.query("SELECT * FROM clients ORDER BY created_at")]


def rename(db: ServerDB, client_id: int, name: str) -> None:
    db.execute("UPDATE clients SET name = ? WHERE id = ?", ((name or "").strip()[:80] or "Client", client_id))


def revoke(db: ServerDB, client_id: int) -> None:
    db.execute("UPDATE clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (time.time(), client_id))


def delete(db: ServerDB, client_id: int) -> None:
    db.execute("DELETE FROM clients WHERE id = ?", (client_id,))


def verify(db: ServerDB, key: str | None, version: str | None = None) -> Client | None:
    if not key or not key.startswith(PREFIX):
        return None
    r = db.one("SELECT * FROM clients WHERE key_hash = ? AND revoked_at IS NULL", (_hash(key),))
    if not r:
        return None
    db.execute("UPDATE clients SET last_seen_at = ?, last_version = COALESCE(?, last_version) WHERE id = ?",
               (time.time(), version, r["id"]))
    return _row(r)


def owns(db: ServerDB, client_id: int, meeting_id: str) -> bool:
    return bool(db.one("SELECT 1 FROM uploads WHERE meeting_id = ? AND client_id = ?", (meeting_id, client_id)))


def record_upload(db: ServerDB, client_id: int, meeting_id: str, nbytes: int) -> None:
    db.execute("INSERT INTO uploads(meeting_id, client_id, created_at, bytes) VALUES (?,?,?,?)"
               " ON CONFLICT(meeting_id) DO UPDATE SET bytes = excluded.bytes", (meeting_id, client_id, time.time(), nbytes))
