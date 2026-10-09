"""Who may see which recordings.

- A client's *scope* is `own` (recordings it uploaded) or `all`; an admin sets it per client.
- An MCP token inherits the scope of the client it was made for.
- In the dashboard an admin sees everything; another account sees the recordings of its own
  clients, or everything when one of its clients has scope `all`.

`None` means "no restriction"; a set means "exactly these meeting ids".
"""
from __future__ import annotations

from .db import ServerDB

SCOPES = ("own", "all")


def ids_for_clients(db: ServerDB, client_ids: list[int]) -> set[str]:
    if not client_ids:
        return set()
    marks = ",".join("?" * len(client_ids))
    return {r["meeting_id"] for r in db.query(f"SELECT meeting_id FROM uploads WHERE client_id IN ({marks})", client_ids)}


def visible_for_client(db: ServerDB, client_id: int, scope: str) -> set[str] | None:
    return None if scope == "all" else ids_for_clients(db, [client_id])


def visible_for_user(db: ServerDB, user_id: int, role: str) -> set[str] | None:
    if role == "admin":
        return None
    rows = db.query("SELECT id, scope FROM clients WHERE user_id = ? AND revoked_at IS NULL", (user_id,))
    if any(r["scope"] == "all" for r in rows):
        return None
    return ids_for_clients(db, [r["id"] for r in rows])


def allowed(visible: set[str] | None, meeting_id: str) -> bool:
    return visible is None or meeting_id in visible
