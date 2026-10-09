"""Huddle Server: one process that embeds the Huddle engine and puts four doors in front of it.

  /v1/…      clients (Huddle desktop) — client key, scoped to what that client may see
  /mcp       MCP for AI tools — MCP token, inheriting the scope of the client it belongs to
  /api/…     the dashboard's endpoints — session cookie; admin-only paths listed below
  /engine/…  the engine's own API (settings, models) — admins only
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
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__, access, api_client, api_dashboard, auth, certs, mcp_scoped, mcp_tokens
from .config import ServerConfig, apply_engine_env
from .db import ServerDB

log = logging.getLogger("huddle.server")

# Reachable without a session.
PUBLIC_API = {"/api/setup", "/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/auth/me", "/api/info"}
PUBLIC_PREFIXES = ("/api/auth/invite/",)
# Allowed while the second factor is still pending.
TOTP_PENDING_OK = {"/api/auth/totp", "/api/auth/logout", "/api/auth/me"}
# Admin only: everything that configures the server or looks at other accounts.
ADMIN_PATHS = ("/engine", "/api/overview", "/api/server", "/api/users", "/api/invites")
STATIC = Path(__file__).parent / "static"
CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"


def create_app(cfg: ServerConfig | None = None) -> FastAPI:
    cfg = cfg or ServerConfig()
    cfg.ensure_dirs()
    apply_engine_env(cfg)
    from .engine_bridge import engine_app, engine_ctx, engine_lifespan  # imports the engine with our env in place

    mcp: dict = {"server": None, "app": None}

    class McpDoor:
        """ASGI door for /mcp (registered before the catch-all route); the real MCP app exists once
        the engine is up. It serves one endpoint, so the inner path is always '/'."""
        async def __call__(self, scope, receive, send):
            inner = mcp["app"]
            if inner is None:
                await JSONResponse({"error": "starting"}, status_code=503)(scope, receive, send)
                return
            if scope["type"] == "http":
                scope = dict(scope, path="/", raw_path=b"/")
            await inner(scope, receive, send)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.cfg = cfg
        app.state.db = ServerDB(cfg.db_path)
        cfg.name = app.state.db.get_config("name", cfg.name)
        if cfg.tls_dir:
            cert, _ = certs.ensure(cfg.tls_dir, cfg.name)
            log.info("TLS certificate %s · fingerprint %s", cert, certs.fingerprint(cert))
        async with engine_lifespan(engine_app):
            _server_engine_defaults(engine_ctx())
            server = mcp_scoped.build(engine_ctx().db)
            mcp["server"] = server
            mcp_app = server.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True, host="0.0.0.0",
                                                 transport_security=_transport_security())
            mcp_app.add_middleware(_McpAuth, db=app.state.db)
            mcp["app"] = mcp_app
            async with server.session_manager.run():
                stop = threading.Event()
                threading.Thread(target=_housekeeping, args=(app, stop), name="huddle-server-housekeeping", daemon=True).start()
                log.info("Huddle Server %s ready · %s · data %s", __version__, cfg.name, cfg.data_dir)
                try:
                    yield
                finally:
                    stop.set()
        app.state.db.close()

    app = FastAPI(title="Huddle Server", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def gate(request: Request, call_next):
        path = request.url.path
        if path.startswith(("/api/", "/engine/")) or path == "/engine":
            db: ServerDB = request.app.state.db
            session = auth.get_session(db, request.cookies.get(auth.COOKIE), request.app.state.cfg.session_hours)
            request.state.session = session
            public = path in PUBLIC_API or path.startswith(PUBLIC_PREFIXES)
            if not public:
                if not session:
                    return JSONResponse({"detail": "Log in first"}, status_code=401)
                if not session.totp_ok and path not in TOTP_PENDING_OK:
                    return JSONResponse({"detail": "Enter your authenticator code"}, status_code=401)
                if path.startswith(ADMIN_PATHS) and not session.user.is_admin:
                    return JSONResponse({"detail": "Admins only"}, status_code=403)
            # cross-site request forgery: browsers cannot add this header from another origin
            if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-requested-with") != "huddle":
                return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        api_like = path.startswith(("/api/", "/engine", "/v1/", "/mcp"))
        if not api_like:
            response.headers.setdefault("Content-Security-Policy", CSP)
        else:
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.include_router(api_client.router)
    app.include_router(api_dashboard.router)
    app.mount("/engine", engine_app)
    app.add_route("/mcp", McpDoor(), methods=["GET", "POST", "DELETE"])

    @app.get("/health")
    def health():
        try:
            engine_ctx()
            return {"ok": True}
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
        return JSONResponse({"detail": "Dashboard not built. Run `npm run build:server` in dashboard/."}, status_code=404)

    return app


def _server_engine_defaults(c) -> None:
    """Engine settings that differ on a server: voices are recognised on the clients, never across
    accounts here; the engine's own network MCP stays off (the server serves a scoped one)."""
    patch = {}
    s = c.settings()
    if s.get("speakers.recognition", True):
        patch["speakers.recognition"] = False
    if s.get("mcp.networkEnabled", False):
        patch["mcp.networkEnabled"] = False
    if patch:
        c.update_settings(patch)


def _transport_security():
    from mcp.server.transport_security import TransportSecuritySettings
    return TransportSecuritySettings(enable_dns_rebinding_protection=False)


class _McpAuth(BaseHTTPMiddleware):
    """Bearer hmt_… → the token's client and scope, handed to the tools through a context variable."""

    def __init__(self, app, db: ServerDB):
        super().__init__(app)
        self.db = db

    async def dispatch(self, request, call_next):
        header = request.headers.get("authorization", "")
        tok = mcp_tokens.verify(self.db, header[7:].strip() if header.lower().startswith("bearer ") else None)
        if not tok:
            return JSONResponse({"error": "unauthorized — use an MCP token from Huddle Server"}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})
        scope = mcp_scoped.Scope(client_id=tok.client_id, client_name=tok.client_name,
                                 visible=access.visible_for_client(self.db, tok.client_id, tok.scope))
        token = mcp_scoped.current_scope.set(scope)
        try:
            return await call_next(request)
        finally:
            mcp_scoped.current_scope.reset(token)


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
