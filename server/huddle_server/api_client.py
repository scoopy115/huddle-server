"""/v1 — what Huddle desktop (and later other clients) talk to. Authenticated with a client key
(``Authorization: Bearer hsk_…``). A client only ever sees the recordings it sent."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from huddle_engine.schemas import MODES, CreateFromRecordingRequest
from huddle_engine.services import meetings as ms
from huddle_engine.services.bundle import export_bundle
from pydantic import BaseModel

from . import __version__, access, clients, mcp_tokens
from .clients import Client
from .engine_bridge import capabilities, engine_ctx, engine_version

router = APIRouter(prefix="/v1")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$")
EXT = {"flac": ".flac", "wav": ".wav", "m4a": ".m4a", "mp3": ".mp3", "ogg": ".ogg", "webm": ".webm"}


def _client(request: Request) -> Client:
    header = request.headers.get("authorization", "")
    key = header[7:].strip() if header.lower().startswith("bearer ") else None
    c = clients.verify(request.app.state.db, key, request.headers.get("x-huddle-client-version"))
    if not c:
        raise HTTPException(401, "Invalid or revoked client key")
    return c


ClientDep = Annotated[Client, Depends(_client)]


@router.get("/ping")
def ping(request: Request, client: ClientDep):
    return {"name": request.app.state.cfg.name, "version": __version__, "engineVersion": engine_version,
            "client": client.name, "scope": client.scope, "capabilities": capabilities()}


def _visible(request: Request, client: Client) -> set[str] | None:
    return access.visible_for_client(request.app.state.db, client.id, client.scope)


@router.get("/recordings")
def list_recordings(request: Request, client: ClientDep, limit: int = 200):
    """Recordings this client may see (its own, or all with scope `all`)."""
    c = engine_ctx()
    vis = _visible(request, client)
    out = [m for m in ms.list_meetings(c.db, limit=max(1, min(limit, 1000)) * (4 if vis is not None else 1)) if access.allowed(vis, m.id)]
    return [{"id": m.id, "title": m.title, "startedAt": m.started_at, "durationSec": m.duration_sec, "status": m.status,
             "mode": m.mode, "language": m.language, "participants": m.participants, "summaryPreview": m.summary_preview,
             "own": clients.owns(request.app.state.db, client.id, m.id)} for m in out[:limit]]


def _job_view(meeting_id: str) -> dict[str, Any]:
    c = engine_ctx()
    m = ms.get_meeting(c.db, meeting_id)
    if not m:
        raise HTTPException(404, "Recording not found")
    job = ms.get_job(c.db, meeting_id)
    state = job.state if job else ("ready" if m.status == "ready" else "saved")
    return {"id": meeting_id, "state": state, "status": m.status,
            "job": job.model_dump(by_alias=True) if job else None,
            "error": job.error if job else None, "errorDetail": job.error_detail if job else None}


@router.post("/recordings")
async def upload(request: Request, client: ClientDep, meta: Annotated[str, Form()], audio: Annotated[UploadFile, File()]):
    try:
        m = json.loads(meta)
    except ValueError:
        raise HTTPException(400, "meta must be JSON") from None
    rid = await store_upload(request, client, m, audio)
    return _job_view(rid)


async def store_upload(request: Request, client: Client, m: dict, audio: UploadFile) -> str:
    """Save an uploaded recording for `client`, create the meeting and start processing. Shared by
    the client API and the dashboard's own recorder."""
    c = engine_ctx()
    sdb = request.app.state.db
    rid = str(m.get("id") or "")
    if not ID_RE.match(rid):
        raise HTTPException(400, "Invalid recording id")
    existing = ms.get_meeting(c.db, rid)
    if existing and not clients.owns(sdb, client.id, rid):
        raise HTTPException(409, "A recording with this id belongs to another client")
    max_bytes = request.app.state.cfg.max_upload_mb * 1024 * 1024
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > max_bytes:
        raise HTTPException(413, f"The upload is larger than the server allows ({request.app.state.cfg.max_upload_mb} MB)")
    fmt = str(m.get("format") or Path(audio.filename or "").suffix.lstrip(".") or "wav").lower()
    folder = c.cfg.recordings_dir / rid
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"audio{EXT.get(fmt, '.' + re.sub(r'[^a-z0-9]', '', fmt)[:5] or '.bin')}"
    size = 0
    with dest.open("wb") as fh:
        while chunk := await audio.read(1 << 20):
            size += len(chunk)
            if size > max_bytes:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"The upload is larger than the server allows ({request.app.state.cfg.max_upload_mb} MB)")
            fh.write(chunk)
    if size < 1000:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "The audio file is empty")
    if existing:
        # re-upload (retry from the desktop): fresh audio, everything processed again
        c.jobs.cancel(rid)
        c.db.execute("UPDATE recordings SET file_path = ?, processed_path = NULL, status = 'saved', size_bytes = ?, format = ?"
                     " WHERE meeting_id = ?", (str(dest), size, fmt, rid))
    else:
        ms.create_from_recording(c.db, c.cfg, CreateFromRecordingRequest(
            id=rid, file_path=str(dest), started_at=float(m.get("startedAt") or 0) or __import__("time").time(),
            duration_sec=float(m.get("durationSec") or 0), input_device=m.get("inputDevice"), sample_rate=m.get("sampleRate"),
            channels=m.get("channels"), format=fmt, title=(m.get("title") or None), language=(m.get("language") or None),
            speaker_count=(int(m["speakerCount"]) if m.get("speakerCount") else None),
            mode=m.get("mode") if m.get("mode") in MODES else "meeting", source="recorded", process=False,
            notes_language=(str(m.get("notesLanguage") or "")[:8] or None)))
    if m.get("context"):
        ms.update_meeting(c.db, rid, context_html=str(m["context"])[:20000])
    clients.record_upload(sdb, client.id, rid, size)
    enqueue_for(client, rid)
    return rid


def enqueue_for(client: Client, rid: str) -> None:
    """Run the pipeline for a client's recording. With AI off for the client the notes stages are
    marked skipped up front, so the job never waits on them and the dashboard shows why."""
    import json
    import time as _t
    c = engine_ctx()
    if client.ai_enabled:
        c.jobs.enqueue(rid)
        return
    from huddle_engine.schemas import DEFAULT_PIPELINE, STAGES
    names = [n for n in DEFAULT_PIPELINE if n != "summarizing"]
    stages = {n: ({"status": "skipped", "detail": "AI notes are off for this client"} if n in ("summarizing", "extracting_actions")
                  else {"status": "pending" if n in names else "skipped"}) for n in STAGES}
    now = _t.time()
    c.db.execute("INSERT INTO processing_jobs(meeting_id, state, current_stage, stages_json, error, error_detail, created_at, updated_at)"
                 " VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET stages_json=excluded.stages_json, updated_at=excluded.updated_at",
                 (rid, "queued", None, json.dumps(stages), None, None, now, now))
    c.jobs.enqueue(rid, names)


def _owned(request: Request, client: Client, rid: str) -> None:
    """Writes stay with the uploading client; reads follow the scope."""
    if not clients.owns(request.app.state.db, client.id, rid):
        raise HTTPException(404, "Recording not found")


def _readable(request: Request, client: Client, rid: str) -> None:
    if not access.allowed(_visible(request, client), rid) or not engine_ctx().db.one("SELECT 1 FROM meetings WHERE id = ?", (rid,)):
        raise HTTPException(404, "Recording not found")


@router.get("/recordings/{rid}")
def status(request: Request, client: ClientDep, rid: str):
    _readable(request, client, rid)
    return _job_view(rid)


@router.get("/recordings/{rid}/result")
def result(request: Request, client: ClientDep, rid: str):
    _readable(request, client, rid)
    c = engine_ctx()
    job = ms.get_job(c.db, rid)
    if not job or job.state not in ("ready", "failed"):
        raise HTTPException(409, "Still processing")
    try:
        return export_bundle(c.db, rid)
    except KeyError:
        raise HTTPException(404, "Recording not found") from None


@router.post("/recordings/{rid}/process")
def reprocess(request: Request, client: ClientDep, rid: str):
    _owned(request, client, rid)
    enqueue_for(client, rid)
    return _job_view(rid)


@router.post("/recordings/{rid}/cancel")
def cancel(request: Request, client: ClientDep, rid: str):
    _owned(request, client, rid)
    engine_ctx().jobs.cancel(rid)
    return {"ok": True}


@router.delete("/recordings/{rid}")
def delete(request: Request, client: ClientDep, rid: str):
    _owned(request, client, rid)
    c = engine_ctx()
    c.jobs.cancel(rid)
    ms.delete_meeting(c.db, c.cfg, rid)
    shutil.rmtree(c.cfg.recordings_dir / rid, ignore_errors=True)
    request.app.state.db.execute("DELETE FROM uploads WHERE meeting_id = ?", (rid,))
    return {"ok": True}


# ---- MCP tokens: made by the client, carrying the client's scope ------------- #
class NewToken(BaseModel):
    name: str = "MCP client"
    days: int = 90


@router.get("/mcp-tokens")
def list_tokens(request: Request, client: ClientDep):
    return [t.public() for t in mcp_tokens.list_for_client(request.app.state.db, client.id)]


@router.post("/mcp-tokens")
def create_token(request: Request, client: ClientDep, body: NewToken):
    t = mcp_tokens.create(request.app.state.db, client.id, body.name, body.days)
    base = str(request.headers.get("x-forwarded-proto", request.url.scheme)) + "://" + str(request.headers.get("x-forwarded-host") or request.headers.get("host") or "")
    return {**t.public(), "url": base + "/mcp"}


@router.delete("/mcp-tokens/{token_id}")
def delete_token(request: Request, client: ClientDep, token_id: int):
    t = mcp_tokens.get(request.app.state.db, token_id)
    if not t or t.client_id != client.id:
        raise HTTPException(404, "Token not found")
    mcp_tokens.delete(request.app.state.db, token_id)
    return {"ok": True}
