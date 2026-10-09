"""MCP tokens: made by a client (from the Huddle app or the dashboard), carrying that client's
scope. `hmt_…`, hashed at rest, optional expiry, revocable on their own and gone with the client."""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from .db import ServerDB

PREFIX = "hmt_"
VALID_DAYS = (30, 60, 90, 365)


@dataclass
class McpToken:
    id: int
    client_id: int
    client_name: str
    name: str
    prefix: str
    created_at: float
    expires_at: float | None
    last_used_at: float | None
    revoked: bool
    scope: str
    token: str | None = None

    def public(self) -> dict:
        return {"id": self.id, "clientId": self.client_id, "clientName": self.client_name, "name": self.name, "prefix": self.prefix,
                "createdAt": self.created_at, "expiresAt": self.expires_at, "lastUsedAt": self.last_used_at,
                "expired": bool(self.expires_at and self.expires_at < time.time()), "revoked": self.revoked, "scope": self.scope,
                "token": self.token}


_SQL = "SELECT t.*, c.name AS client_name, c.scope FROM mcp_tokens t JOIN clients c ON c.id = t.client_id"


def _row(r) -> McpToken:
    return McpToken(id=r["id"], client_id=r["client_id"], client_name=r["client_name"], name=r["name"], prefix=r["prefix"],
                    created_at=r["created_at"], expires_at=r["expires_at"], last_used_at=r["last_used_at"],
                    revoked=bool(r["revoked_at"]), scope=r["scope"])


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def create(db: ServerDB, client_id: int, name: str, days: int | None = 90) -> McpToken:
    days = days if days in VALID_DAYS else 90
    token = PREFIX + secrets.token_urlsafe(32)
    cur = db.execute("INSERT INTO mcp_tokens(client_id, name, token_hash, prefix, created_at, expires_at) VALUES (?,?,?,?,?,?)",
                     (client_id, (name or "").strip()[:80] or "MCP client", _hash(token), token[:12], time.time(),
                      time.time() + days * 86400))
    t = _row(db.one(_SQL + " WHERE t.id = ?", (cur.lastrowid,)))
    t.token = token
    return t


def list_for_client(db: ServerDB, client_id: int) -> list[McpToken]:
    return [_row(r) for r in db.query(_SQL + " WHERE t.client_id = ? ORDER BY t.created_at", (client_id,))]


def list_for_user(db: ServerDB, user_id: int | None) -> list[McpToken]:
    if user_id is None:
        return [_row(r) for r in db.query(_SQL + " ORDER BY t.created_at")]
    return [_row(r) for r in db.query(_SQL + " WHERE c.user_id = ? ORDER BY t.created_at", (user_id,))]


def get(db: ServerDB, token_id: int) -> McpToken | None:
    r = db.one(_SQL + " WHERE t.id = ?", (token_id,))
    return _row(r) if r else None


def revoke(db: ServerDB, token_id: int) -> None:
    db.execute("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (time.time(), token_id))


def delete(db: ServerDB, token_id: int) -> None:
    db.execute("DELETE FROM mcp_tokens WHERE id = ?", (token_id,))


def verify(db: ServerDB, token: str | None) -> McpToken | None:
    """The token's client must be alive too: revoking a client silences its MCP tokens."""
    if not token or not token.startswith(PREFIX):
        return None
    r = db.one(_SQL + " WHERE t.token_hash = ? AND t.revoked_at IS NULL AND c.revoked_at IS NULL", (_hash(token),))
    if not r or (r["expires_at"] and r["expires_at"] < time.time()):
        return None
    db.execute("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?", (time.time(), r["id"]))
    return _row(r)
