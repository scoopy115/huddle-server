"""Huddle Server: one process that embeds the Huddle engine and puts three doors in front of it.

  /v1/…      clients (Huddle desktop) — client key
  /api/…     the dashboard's own endpoints — session cookie
  /engine/…  the engine's API for the dashboard (meetings, models, settings) — session cookie
  /…         the dashboard itself (static files)

TLS, the public port and the dashboard port are Caddy's job (see docker-compose.yml).
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, api_client, api_dashboard, auth, certs
from .config import ServerConfig, apply_engine_env
from .db import ServerDB

log = logging.getLogger("huddle.server")

PUBLIC_API = {"/api/setup", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/info"}
TOTP_PENDING_OK = {"/api/auth/totp", "/api/auth/logout", "/api/auth/me"}
STATIC = Path(__file__).parent / "static"


def create_app(cfg: ServerConfig | None = None) -> FastAPI:
    cfg = cfg or ServerConfig()
    cfg.ensure_dirs()
    apply_engine_env(cfg)
    from .engine_bridge import engine_app, engine_ctx, engine_lifespan   # imports the engine with our env in place

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.cfg = cfg
        app.state.db = ServerDB(cfg.db_path)
        cfg.name = app.state.db.get_config("name", cfg.name)
        if cfg.tls_dir:
            cert, _ = certs.ensure(cfg.tls_dir, cfg.name)
            log.info("TLS certificate %s · fingerprint %s", cert, certs.fingerprint(cert))
        async with engine_lifespan(engine_app):
            stop = threading.Event()
            threading.Thread(target=_housekeeping, args=(app, stop), name="huddle-server-housekeeping", daemon=True).start()
            log.info("Huddle Server %s ready · %s · data %s", __version__, cfg.name, cfg.data_dir)
            try:
                yield
            finally:
                stop.set()
        app.state.db.close()

    app = FastAPI(title="Huddle Server", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def gate(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/") or path.startswith("/engine/") or path == "/engine":
            db: ServerDB = request.app.state.db
            session = auth.get_session(db, request.cookies.get(auth.COOKIE), request.app.state.cfg.session_hours)
            request.state.session = session
            if path not in PUBLIC_API:
                if not session:
                    return JSONResponse({"detail": "Log in first"}, status_code=401)
                if not session.totp_ok and path not in TOTP_PENDING_OK:
                    return JSONResponse({"detail": "Enter your authenticator code"}, status_code=401)
                # cross-site request forgery: browsers cannot add this header from another origin
                if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-requested-with") != "huddle":
                    return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    app.include_router(api_client.router)
    app.include_router(api_dashboard.router)
    app.mount("/engine", engine_app)

    @app.get("/health")
    def health():
        try:
            c = engine_ctx()
            return {"ok": True, "version": __version__, "activeJob": c.jobs.active_meeting}
        except AssertionError:
            return JSONResponse({"ok": False}, status_code=503)

    if (STATIC / "assets").exists():
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = STATIC / path
        if path and candidate.is_file() and candidate.resolve().is_relative_to(STATIC.resolve()):
            return FileResponse(candidate)
        index = STATIC / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse({"detail": "Dashboard not built. Run `npm run build` in dashboard/."}, status_code=404)

    return app


def _housekeeping(app: FastAPI, stop: threading.Event) -> None:
    """Hourly: audio retention, the storage cap and expired sessions."""
    from huddle_engine.services import meetings as ms
    from .engine_bridge import engine_ctx
    while not stop.wait(3600):
        try:
            c = engine_ctx()
            days = int(c.settings().get("privacy.retentionDays") or 0)
            if days > 0:
                n = ms.apply_retention(c.db, c.cfg, days)
                if n:
                    log.info("retention: removed audio of %d meetings older than %d days", n, days)
            c.enforce_storage()
            auth.purge_sessions(app.state.db)
        except Exception:
            log.exception("housekeeping failed")
        time.sleep(0)


app = create_app()
