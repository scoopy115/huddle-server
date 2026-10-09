"""/api — the dashboard's endpoints. Setup, login (+TOTP), registration by invitation or with
approval, accounts, clients and their scopes, MCP tokens, and the meetings an account may see.
Admin-only paths are listed in app.ADMIN_PATHS; the rest checks ownership per record."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from huddle_engine.services import meetings as ms
from huddle_engine.services import search as search_svc
from pydantic import BaseModel

from . import __version__, access, auth, certs, clients, mcp_tokens
from .engine_bridge import capabilities, engine_ctx, engine_version, resolver

router = APIRouter(prefix="/api")


def _cookie(request: Request, response: Response, sid: str | None) -> None:
    """Secure cookie when the dashboard is reached over https (directly or through a reverse proxy)."""
    cfg = request.app.state.cfg
    https = (request.headers.get("x-forwarded-proto") or request.url.scheme) == "https"
    if sid:
        response.set_cookie(auth.COOKIE, sid, max_age=cfg.session_hours * 3600, httponly=True, secure=https, samesite="lax", path="/")
    else:
        response.delete_cookie(auth.COOKIE, path="/")


def _addr(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "").split(",")[0].strip()


def _session(request: Request) -> auth.Session:
    s: auth.Session | None = getattr(request.state, "session", None)
    if not s or not s.totp_ok:
        raise HTTPException(401, "Log in first")
    return s


def _public_url(request: Request) -> str:
    cfg = request.app.state.cfg
    if cfg.public_url:
        return cfg.public_url
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0]
    return f"{proto}://{host}"


def _registration(db) -> str:
    return db.get_config("registration", "invite")


class Credentials(BaseModel):
    email: str
    password: str


class Registration(BaseModel):
    email: str
    password: str
    invite: str | None = None


class Code(BaseModel):
    code: str


class Password(BaseModel):
    current: str
    new: str


class NewPassword(BaseModel):
    password: str


class Named(BaseModel):
    name: str


class ClientPatch(BaseModel):
    name: str | None = None
    scope: str | None = None
    ai_enabled: bool | None = None


class Onboarding(BaseModel):
    completed: bool


class ServerPatch(BaseModel):
    name: str | None = None
    registration: str | None = None


class UserPatch(BaseModel):
    role: str | None = None
    approved: bool | None = None


class InviteBody(BaseModel):
    email: str | None = None


class NewToken(BaseModel):
    name: str = "MCP client"
    days: int = 90


# ---- setup / auth ------------------------------------------------------------- #
@router.get("/setup")
def setup_state(request: Request):
    db = request.app.state.db
    return {"needsSetup": auth.user_count(db) == 0, "name": request.app.state.cfg.name,
            "registration": _registration(db) if auth.user_count(db) else "invite"}


@router.post("/setup")
def setup(request: Request, response: Response, body: Credentials):
    db = request.app.state.db
    if auth.user_count(db) > 0:
        raise HTTPException(403, "The server already has an account")
    try:
        user = auth.create_user(db, body.email, body.password, role="admin")
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    s = auth.create_session(db, user, request.app.state.cfg.session_hours, request.headers.get("user-agent"))
    _cookie(request, response, s.id)
    return _me(request, s)


def _me(request: Request, s: auth.Session | None) -> dict[str, Any]:
    db = request.app.state.db
    base = {"user": None, "totpRequired": False, "registration": _registration(db)}
    if not s:
        return base
    if not s.totp_ok:
        return {**base, "totpRequired": True}
    return {**base, "user": s.user.public(), "canSeeAll": access.visible_for_user(db, s.user.id, s.user.role) is None}


@router.post("/auth/login")
def login(request: Request, response: Response, body: Credentials):
    db = request.app.state.db
    try:
        user = auth.verify_password(db, body.email, body.password, _addr(request))
    except auth.AuthError as e:
        raise HTTPException(401, str(e)) from None
    s = auth.create_session(db, user, request.app.state.cfg.session_hours, request.headers.get("user-agent"))
    _cookie(request, response, s.id)
    return _me(request, s)


@router.post("/auth/register")
def register(request: Request, response: Response, body: Registration):
    """New account: with an invitation it is active at once; with open registration it waits for an admin."""
    db = request.app.state.db
    if auth.user_count(db) == 0:
        raise HTTPException(403, "Create the admin account first")
    try:
        user = auth.register(db, body.email, body.password, body.invite, _registration(db) == "open", _addr(request))
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    if not user.approved:
        return {"pending": True, **_me(request, None)}
    s = auth.create_session(db, user, request.app.state.cfg.session_hours, request.headers.get("user-agent"))
    _cookie(request, response, s.id)
    return {"pending": False, **_me(request, s)}


@router.get("/auth/invite/{token}")
def invite_state(request: Request, token: str):
    inv = auth.check_invite(request.app.state.db, token)
    return {"valid": bool(inv), "email": inv["email"] if inv else None}


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
    return _me(request, s)


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    s: auth.Session | None = getattr(request.state, "session", None)
    if s:
        auth.delete_session(request.app.state.db, s.id)
    _cookie(request, response, None)
    return {"ok": True}


@router.get("/auth/me")
def me(request: Request):
    return _me(request, getattr(request.state, "session", None))


# ---- public info: only what a client needs before logging in ------------------- #
@router.get("/info")
def info(request: Request):
    cfg = request.app.state.cfg
    fp = certs.fingerprint(cfg.tls_dir / "server.crt") if cfg.tls_dir else None
    return {"name": cfg.name, "fingerprint": fp}


# ---- admin: overview, server, users, invites ------------------------------------ #
@router.get("/overview")
def overview(request: Request):
    import time as _t
    cfg = request.app.state.cfg
    db = request.app.state.db
    c = engine_ctx()
    fp = certs.fingerprint(cfg.tls_dir / "server.crt") if cfg.tls_dir else None
    from huddle_engine.resolver import resolve_all
    # processed per day, last 30 days (local time of the server)
    since = _t.time() - 30 * 86400
    days: dict[str, dict] = {}
    for r in c.db.query("SELECT started_at, duration_sec, status FROM meetings WHERE started_at >= ?", (since,)):
        key = _t.strftime("%Y-%m-%d", _t.localtime(r["started_at"]))
        d = days.setdefault(key, {"date": key, "meetings": 0, "minutes": 0.0})
        d["meetings"] += 1
        d["minutes"] += (r["duration_sec"] or 0) / 60
    totals = c.db.one("SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec), 0) AS sec FROM meetings WHERE status = 'ready'")
    gpu = [d for d in c.hardware.get("gpus", []) if isinstance(d, dict)] if isinstance(c.hardware.get("gpus"), list) else []
    return {"name": cfg.name, "version": __version__, "engineVersion": engine_version, "fingerprint": fp, "publicUrl": _public_url(request),
            "hardware": {**c.hardware, "gpu": (gpu[0].get("name") if gpu else None) or c.hardware.get("acceleratorName")},
            "capabilities": capabilities(), "resolutions": [r.model_dump(by_alias=True) for r in resolve_all(resolver())],
            "meetings": int(c.db.one("SELECT COUNT(*) AS n FROM meetings")["n"]),
            "processing": int(c.db.one("SELECT COUNT(*) AS n FROM meetings WHERE status = 'processing'")["n"]),
            "processed": int(totals["n"]), "processedMinutes": round(float(totals["sec"]) / 60),
            "perDay": [days[k] for k in sorted(days)],
            "activeJob": c.jobs.active_meeting,
            "clients": len([x for x in clients.list_clients(db) if not x.revoked]),
            "users": auth.user_count(db), "pendingUsers": len([u for u in auth.list_users(db) if not u.approved]),
            "mcpTokens": len([t for t in mcp_tokens.list_for_user(db, None) if not t.revoked]),
            "recordingsBytes": ms.recordings_bytes(c.cfg), "maxBytes": int(c.settings().get("storage.maxBytes") or 0),
            "retentionDays": int(c.settings().get("privacy.retentionDays") or 0), "registration": _registration(db),
            "onboarded": db.get_config("onboarding", "") == "done", "speakerModels": _speaker_models_state(request)}


@router.get("/onboarding")
def onboarding_state(request: Request):
    return {"completed": request.app.state.db.get_config("onboarding", "") == "done"}


@router.put("/onboarding")
def onboarding_set(request: Request, body: Onboarding):
    request.app.state.db.set_config("onboarding", "done" if body.completed else "")
    return {"completed": body.completed}


def _speaker_models_state(request: Request) -> dict:
    from huddle_engine.providers import speaker_models
    c = engine_ctx()
    st = getattr(request.app.state, "speaker_dl", None) or {}
    return {"installed": speaker_models.installed(c.cfg.models_dir), "downloading": bool(st.get("running")),
            "progress": st.get("progress", 0.0), "error": st.get("error")}


@router.get("/setup/speaker-models")
def speaker_models_state(request: Request):
    return _speaker_models_state(request)


@router.post("/setup/speaker-models")
def speaker_models_download(request: Request):
    """Fetch the speaker separation models now instead of on the first recording."""
    import threading

    from huddle_engine.providers import speaker_models
    c = engine_ctx()
    st = getattr(request.app.state, "speaker_dl", None)
    if st and st.get("running"):
        return _speaker_models_state(request)
    st = {"running": True, "progress": 0.0, "error": None}
    request.app.state.speaker_dl = st

    def run():
        try:
            speaker_models.ensure_speaker_models(c.cfg.models_dir, progress=lambda f: st.__setitem__("progress", f))
        except Exception as e:  # noqa: BLE001 — network, disk; the message is shown in the dashboard
            st["error"] = str(e)
        finally:
            st["running"] = False
    threading.Thread(target=run, name="huddle-speaker-models", daemon=True).start()
    return _speaker_models_state(request)


@router.put("/server")
def update_server(request: Request, body: ServerPatch):
    cfg = request.app.state.cfg
    db = request.app.state.db
    if body.name is not None:
        cfg.name = body.name.strip()[:60] or "Huddle Server"
        db.set_config("name", cfg.name)
    if body.registration is not None:
        if body.registration not in ("invite", "open"):
            raise HTTPException(400, "registration must be invite or open")
        db.set_config("registration", body.registration)
    return {"name": cfg.name, "registration": _registration(db)}


@router.get("/users")
def list_users(request: Request):
    db = request.app.state.db
    counts = {r["user_id"]: r["n"] for r in db.query("SELECT user_id, COUNT(*) AS n FROM clients WHERE revoked_at IS NULL GROUP BY user_id")}
    return [{**u.public(), "clientCount": counts.get(u.id, 0)} for u in auth.list_users(db)]


@router.patch("/users/{user_id}")
def patch_user(request: Request, user_id: int, body: UserPatch):
    db = request.app.state.db
    s = _session(request)
    if not auth.get_user(db, user_id):
        raise HTTPException(404, "User not found")
    try:
        if body.role is not None:
            if user_id == s.user.id and body.role != "admin":
                raise auth.AuthError("You cannot remove your own admin role.")
            auth.set_role(db, user_id, body.role)
        if body.approved:
            auth.approve(db, user_id)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return auth.get_user(db, user_id).public()


@router.delete("/users/{user_id}")
def delete_user(request: Request, user_id: int):
    s = _session(request)
    if user_id == s.user.id:
        raise HTTPException(400, "You cannot delete your own account here")
    try:
        auth.delete_user(request.app.state.db, user_id)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@router.post("/users/{user_id}/password")
def reset_user_password(request: Request, user_id: int, body: NewPassword):
    db = request.app.state.db
    if not auth.get_user(db, user_id):
        raise HTTPException(404, "User not found")
    try:
        auth.admin_set_password(db, user_id, body.password)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@router.get("/invites")
def list_invites(request: Request):
    return auth.list_invites(request.app.state.db)


@router.post("/invites")
def create_invite(request: Request, body: InviteBody):
    s = _session(request)
    inv = auth.create_invite(request.app.state.db, s.user.id, body.email)
    return {**inv, "url": f"{_public_url(request)}:{request.url.port or ''}".rstrip(":") + f"/join/{inv['token']}"
            if not request.app.state.cfg.public_url else f"{_dashboard_url(request)}/join/{inv['token']}"}


def _dashboard_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    return f"{proto}://{host}"


@router.delete("/invites/{invite_id}")
def delete_invite(request: Request, invite_id: int):
    auth.delete_invite(request.app.state.db, invite_id)
    return {"ok": True}


# ---- clients (own, or all for admins) ------------------------------------------- #
def _client_or_404(request: Request, client_id: int) -> clients.Client:
    s = _session(request)
    c = clients.get(request.app.state.db, client_id)
    if not c or (not s.user.is_admin and c.user_id != s.user.id):
        raise HTTPException(404, "Client not found")
    return c


@router.get("/clients")
def list_clients(request: Request):
    s = _session(request)
    return [c.public() for c in clients.list_clients(request.app.state.db, None if s.user.is_admin else s.user.id)]


@router.post("/clients")
def create_client(request: Request, body: Named):
    s = _session(request)
    return clients.create(request.app.state.db, body.name, s.user.id).public()


@router.patch("/clients/{client_id}")
def patch_client(request: Request, client_id: int, body: ClientPatch):
    s = _session(request)
    c = _client_or_404(request, client_id)
    db = request.app.state.db
    if body.name is not None:
        clients.rename(db, c.id, body.name)
    if body.scope is not None:
        if not s.user.is_admin:
            raise HTTPException(403, "Only an admin changes what a client may see")
        try:
            clients.set_scope(db, c.id, body.scope)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
    if body.ai_enabled is not None:
        if not s.user.is_admin:
            raise HTTPException(403, "Only an admin changes whether a client gets AI notes")
        clients.set_ai(db, c.id, body.ai_enabled)
    return clients.get(db, c.id).public()


@router.post("/clients/{client_id}/revoke")
def revoke_client(request: Request, client_id: int):
    c = _client_or_404(request, client_id)
    clients.revoke(request.app.state.db, c.id)
    return {"ok": True}


@router.delete("/clients/{client_id}")
def delete_client(request: Request, client_id: int):
    c = _client_or_404(request, client_id)
    clients.delete(request.app.state.db, c.id)
    return {"ok": True}


@router.get("/clients/{client_id}/mcp-tokens")
def list_client_tokens(request: Request, client_id: int):
    c = _client_or_404(request, client_id)
    return [t.public() for t in mcp_tokens.list_for_client(request.app.state.db, c.id)]


@router.post("/clients/{client_id}/mcp-tokens")
def create_client_token(request: Request, client_id: int, body: NewToken):
    c = _client_or_404(request, client_id)
    t = mcp_tokens.create(request.app.state.db, c.id, body.name, body.days)
    return {**t.public(), "url": _public_url(request) + "/mcp"}


@router.delete("/mcp-tokens/{token_id}")
def delete_token(request: Request, token_id: int):
    t = mcp_tokens.get(request.app.state.db, token_id)
    if not t:
        raise HTTPException(404, "Token not found")
    _client_or_404(request, t.client_id)
    mcp_tokens.delete(request.app.state.db, token_id)
    return {"ok": True}


# ---- meetings the account may see ------------------------------------------------ #
def _visible(request: Request) -> set[str] | None:
    s = _session(request)
    return access.visible_for_user(request.app.state.db, s.user.id, s.user.role)


def _meeting_or_404(request: Request, meeting_id: str, write: bool = False):
    s = _session(request)
    db = request.app.state.db
    c = engine_ctx()
    m = ms.get_meeting(c.db, meeting_id)
    if not m or not access.allowed(_visible(request), meeting_id):
        raise HTTPException(404, "Meeting not found")
    if write and not s.user.is_admin and clients.owner_user_of_meeting(db, meeting_id) != s.user.id:
        raise HTTPException(403, "Only the account that sent this recording (or an admin) can change it")
    return m


@router.get("/meetings")
def list_meetings(request: Request, q: str | None = None, limit: int = 500):
    vis = _visible(request)
    c = engine_ctx()
    out = [m.model_dump(by_alias=True) for m in ms.list_meetings(c.db, limit=max(1, min(limit, 2000)) * (4 if vis is not None else 1), query=q)
           if access.allowed(vis, m.id)]
    return out[:limit]


@router.get("/search")
def search(request: Request, q: str, limit: int = 50):
    vis = _visible(request)
    c = engine_ctx()
    hits = [h.model_dump(by_alias=True) for h in search_svc.search(c.db, q, limit=limit * (4 if vis is not None else 1)) if access.allowed(vis, h.meeting_id)]
    return hits[:limit]


@router.get("/meetings/{meeting_id}")
def meeting_detail(request: Request, meeting_id: str):
    _meeting_or_404(request, meeting_id)
    c = engine_ctx()
    out = ms.get_detail(c.db, meeting_id).model_dump(by_alias=True)
    out["audioPath"] = ms.audio_path(c.db, c.cfg, meeting_id)
    out["ownerUserId"] = clients.owner_user_of_meeting(request.app.state.db, meeting_id)
    return out


@router.get("/meetings/{meeting_id}/audio")
def meeting_audio(request: Request, meeting_id: str):
    _meeting_or_404(request, meeting_id)
    c = engine_ctx()
    path = ms.audio_path(c.db, c.cfg, meeting_id)
    if not path:
        raise HTTPException(404, "Audio not found")
    return FileResponse(path, media_type="audio/wav")


@router.delete("/meetings/{meeting_id}")
def delete_meeting(request: Request, meeting_id: str):
    _meeting_or_404(request, meeting_id, write=True)
    c = engine_ctx()
    c.jobs.cancel(meeting_id)
    ms.delete_meeting(c.db, c.cfg, meeting_id)
    request.app.state.db.execute("DELETE FROM uploads WHERE meeting_id = ?", (meeting_id,))
    return {"ok": True}


@router.post("/meetings/{meeting_id}/delete-audio")
def delete_audio(request: Request, meeting_id: str):
    _meeting_or_404(request, meeting_id, write=True)
    c = engine_ctx()
    return {"freedBytes": ms.delete_audio(c.db, c.cfg, meeting_id)}


@router.post("/meetings/{meeting_id}/retry/{stage}")
def retry_stage(request: Request, meeting_id: str, stage: str):
    _meeting_or_404(request, meeting_id, write=True)
    try:
        engine_ctx().jobs.retry_stage(meeting_id, stage)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@router.post("/meetings/{meeting_id}/cancel")
def cancel_meeting(request: Request, meeting_id: str):
    _meeting_or_404(request, meeting_id, write=True)
    engine_ctx().jobs.cancel(meeting_id)
    return {"ok": True}


# ---- account ------------------------------------------------------------------- #
@router.post("/account/password")
def change_password(request: Request, response: Response, body: Password):
    s = _session(request)
    try:
        auth.change_password(request.app.state.db, s.user.id, body.current, body.new)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    _cookie(request, response, None)
    return {"ok": True}


@router.post("/account/totp/setup")
def totp_setup(request: Request):
    s = _session(request)
    return auth.totp_setup(request.app.state.db, s.user, request.app.state.cfg.name)


@router.post("/account/totp/enable")
def totp_enable(request: Request, body: Code):
    s = _session(request)
    try:
        auth.totp_enable(request.app.state.db, s.user, body.code)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}


@router.post("/account/totp/disable")
def totp_disable(request: Request, body: Code):
    s = _session(request)
    try:
        auth.totp_disable(request.app.state.db, s.user, body.code)
    except auth.AuthError as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True}
