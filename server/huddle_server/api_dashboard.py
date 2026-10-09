"""/api — the dashboard's own endpoints: setup, login, TOTP, clients, account, server info.
Everything about meetings, models and settings goes through the engine under /engine."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from huddle_engine.services import meetings as ms
from pydantic import BaseModel

from . import __version__, auth, certs, clients
from .engine_bridge import capabilities, engine_ctx, engine_version, resolver

router = APIRouter(prefix="/api")


def _cookie(request: Request, response: Response, sid: str | None) -> None:
    cfg = request.app.state.cfg
    secure = not cfg.insecure_cookies
    if sid:
        response.set_cookie(auth.COOKIE, sid, max_age=cfg.session_hours * 3600, httponly=True, secure=secure, samesite="lax", path="/")
    else:
        response.delete_cookie(auth.COOKIE, path="/")


def _addr(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "").split(",")[0].strip()


class Credentials(BaseModel):
    email: str
    password: str


class Code(BaseModel):
    code: str


class Password(BaseModel):
    current: str
    new: str


class Named(BaseModel):
    name: str


# ---- setup / auth ------------------------------------------------------------- #
@router.get("/setup")
def setup_state(request: Request):
    return {"needsSetup": auth.user_count(request.app.state.db) == 0, "name": request.app.state.cfg.name}


@router.post("/setup")
def setup(request: Request, response: Response, body: Credentials):
    db = request.app.state.db
    if auth.user_count(db) > 0:
        raise HTTPException(403, "The server already has an account")
    try:
        user = auth.create_user(db, body.email, body.password)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    s = auth.create_session(db, user, request.app.state.cfg.session_hours, request.headers.get("user-agent"))
    _cookie(request, response, s.id)
    return _me(s)


def _me(s: auth.Session | None) -> dict[str, Any]:
    if not s:
        return {"user": None, "totpRequired": False}
    return {"user": {"id": s.user.id, "email": s.user.email, "totpEnabled": s.user.totp_enabled} if s.totp_ok else None,
            "totpRequired": not s.totp_ok}


@router.post("/auth/login")
def login(request: Request, response: Response, body: Credentials):
    db = request.app.state.db
    try:
        user = auth.verify_password(db, body.email, body.password, _addr(request))
    except auth.AuthError as e:
        raise HTTPException(401, str(e)) from None
    s = auth.create_session(db, user, request.app.state.cfg.session_hours, request.headers.get("user-agent"))
    _cookie(request, response, s.id)
    return _me(s)


@router.post("/auth/totp")
def login_totp(request: Request, body: Code):
    s: auth.Session | None = getattr(request.state, "session", None)
    if not s:
        raise HTTPException(401, "Log in first")
    try:
        auth.totp_confirm_session(request.app.state.db, s, body.code, _addr(request))
    except auth.AuthError as e:
        raise HTTPException(401, str(e)) from None
    s.totp_ok = True
    return _me(s)


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    s: auth.Session | None = getattr(request.state, "session", None)
    if s:
        auth.delete_session(request.app.state.db, s.id)
    _cookie(request, response, None)
    return {"ok": True}


@router.get("/auth/me")
def me(request: Request):
    return _me(getattr(request.state, "session", None))


# ---- public info ----------------------------------------------------------------- #
@router.get("/info")
def info(request: Request):
    cfg = request.app.state.cfg
    fp = certs.fingerprint(cfg.tls_dir / "server.crt") if cfg.tls_dir else None
    return {"name": cfg.name, "version": __version__, "engineVersion": engine_version, "fingerprint": fp}


# ---- overview (session) ------------------------------------------------------- #
@router.get("/overview")
def overview(request: Request):
    cfg = request.app.state.cfg
    c = engine_ctx()
    fp = certs.fingerprint(cfg.tls_dir / "server.crt") if cfg.tls_dir else None
    n_meetings = int(c.db.one("SELECT COUNT(*) AS n FROM meetings")["n"])
    processing = int(c.db.one("SELECT COUNT(*) AS n FROM meetings WHERE status = 'processing'")["n"])
    from huddle_engine.resolver import resolve_all
    res = [r.model_dump(by_alias=True) for r in resolve_all(resolver())]
    return {"name": cfg.name, "version": __version__, "engineVersion": engine_version, "fingerprint": fp,
            "hardware": c.hardware, "capabilities": capabilities(), "resolutions": res,
            "meetings": n_meetings, "processing": processing, "activeJob": c.jobs.active_meeting,
            "clients": len([x for x in clients.list_clients(request.app.state.db) if not x.revoked]),
            "recordingsBytes": ms.recordings_bytes(c.cfg), "maxBytes": int(c.settings().get("storage.maxBytes") or 0),
            "retentionDays": int(c.settings().get("privacy.retentionDays") or 0),
            "mcp": c.mcp_network.status(c.settings()).model_dump(by_alias=True) if c.mcp_network else None}


@router.put("/server")
def update_server(request: Request, body: Named):
    cfg = request.app.state.cfg
    cfg.name = body.name.strip()[:60] or "Huddle Server"
    request.app.state.db.set_config("name", cfg.name)
    return {"name": cfg.name}


# ---- clients ------------------------------------------------------------------- #
@router.get("/clients")
def list_clients(request: Request):
    return [c.public() for c in clients.list_clients(request.app.state.db)]


@router.post("/clients")
def create_client(request: Request, body: Named):
    return clients.create(request.app.state.db, body.name).public()


@router.patch("/clients/{client_id}")
def rename_client(request: Request, client_id: int, body: Named):
    clients.rename(request.app.state.db, client_id, body.name)
    return {"ok": True}


@router.post("/clients/{client_id}/revoke")
def revoke_client(request: Request, client_id: int):
    clients.revoke(request.app.state.db, client_id)
    return {"ok": True}


@router.delete("/clients/{client_id}")
def delete_client(request: Request, client_id: int):
    clients.delete(request.app.state.db, client_id)
    return {"ok": True}


# ---- account ------------------------------------------------------------------- #
@router.post("/account/password")
def change_password(request: Request, response: Response, body: Password):
    s: auth.Session = request.state.session
    try:
        auth.change_password(request.app.state.db, s.user.id, body.current, body.new)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    _cookie(request, response, None)
    return {"ok": True}


@router.post("/account/totp/setup")
def totp_setup(request: Request):
    s: auth.Session = request.state.session
    return auth.totp_setup(request.app.state.db, s.user, request.app.state.cfg.name)


@router.post("/account/totp/enable")
def totp_enable(request: Request, body: Code):
    s: auth.Session = request.state.session
    try:
        auth.totp_enable(request.app.state.db, s.user, body.code)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@router.post("/account/totp/disable")
def totp_disable(request: Request, body: Code):
    s: auth.Session = request.state.session
    try:
        auth.totp_disable(request.app.state.db, s.user, body.code)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}
