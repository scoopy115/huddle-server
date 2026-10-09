"""Server configuration from the environment (set by docker-compose or the shell)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _data_dir() -> Path:
    return Path(os.getenv("HUDDLE_DATA_DIR") or (Path.home() / ".huddle-server")).expanduser()


@dataclass
class ServerConfig:
    data_dir: Path = field(default_factory=_data_dir)
    host: str = field(default_factory=lambda: os.getenv("HUDDLE_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("HUDDLE_PORT", "48731")))
    name: str = field(default_factory=lambda: os.getenv("HUDDLE_SERVER_NAME", "Huddle Server"))
    tls_dir: Path | None = field(default_factory=lambda: Path(os.environ["HUDDLE_TLS_DIR"]) if os.getenv("HUDDLE_TLS_DIR") else None)
    # hours a dashboard session stays valid without activity
    session_hours: int = field(default_factory=lambda: int(os.getenv("HUDDLE_SESSION_HOURS", "72")))
    # largest recording a client may send (a FLAC hour at 16 kHz mono is ~60 MB)
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("HUDDLE_MAX_UPLOAD_MB", "2048")))
    # public URL of this server as clients reach it (for links in the dashboard); derived from the request when empty
    public_url: str = field(default_factory=lambda: os.getenv("HUDDLE_PUBLIC_URL", "").rstrip("/"))

    @property
    def db_path(self) -> Path:
        return self.data_dir / "server.db"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if self.tls_dir:
            self.tls_dir.mkdir(parents=True, exist_ok=True)


def apply_engine_env(cfg: ServerConfig) -> None:
    """The engine reads its configuration from the environment; make it match ours before it is
    imported. The server fronts the engine, so the engine itself needs no token."""
    os.environ.setdefault("HUDDLE_DATA_DIR", str(cfg.data_dir))
    # the engine's own network MCP stays off: MCP is served by the server itself (scoped per token)
    os.environ.pop("HUDDLE_MCP_BIND_PUBLIC", None)
    os.environ.setdefault("HUDDLE_SYSTEM_LANGUAGE", "en")
    os.environ.pop("HUDDLE_TOKEN", None)
    os.environ.pop("HUDDLE_PARENT_PID", None)
