"""The server's own SQLite database (accounts, sessions, clients, uploads). Kept apart from the
engine's huddle.db so engine migrations never touch it."""
from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = [
    (1, """
    CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        totp_secret   TEXT,
        totp_enabled  INTEGER NOT NULL DEFAULT 0,
        created_at    REAL NOT NULL
    );
    CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  REAL NOT NULL,
        last_seen   REAL NOT NULL,
        expires_at  REAL NOT NULL,
        totp_ok     INTEGER NOT NULL DEFAULT 0,
        user_agent  TEXT
    );
    CREATE TABLE clients (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        key_hash     TEXT NOT NULL UNIQUE,
        prefix       TEXT NOT NULL,
        created_at   REAL NOT NULL,
        last_seen_at REAL,
        last_version TEXT,
        revoked_at   REAL
    );
    CREATE TABLE uploads (
        meeting_id  TEXT PRIMARY KEY,
        client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        created_at  REAL NOT NULL,
        bytes       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_uploads_client ON uploads(client_id, created_at);
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """),
]


class ServerDB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.RLock()
        self.migrate()

    def migrate(self) -> None:
        current = self._conn.execute("PRAGMA user_version").fetchone()[0]
        for version, script in SCHEMA:
            if version <= current:
                continue
            self._conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version = {version};\nCOMMIT;")

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def query(self, sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, args).fetchone()

    def execute(self, sql: str, args: tuple | list = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, args)

    def get_config(self, key: str, default: str = "") -> str:
        r = self.one("SELECT value FROM config WHERE key = ?", (key,))
        return r["value"] if r else default

    def set_config(self, key: str, value: str) -> None:
        self.execute("INSERT INTO config(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def close(self) -> None:
        self._conn.close()
