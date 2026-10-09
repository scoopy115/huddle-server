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

from . import __version__, clients
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
            "client": client.name, "capabilities": capabilities()}


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
    c = engine_ctx()
    sdb = request.app.state.db
    try:
        m = json.loads(meta)
    except ValueError:
        raise HTTPException(400, "meta must be JSON") from None
    rid = str(m.get("id") or "")
    if not ID_RE.match(rid):
        raise HTTPException(400, "Invalid recording id")
    existing = ms.get_meeting(c.db, rid)
    if existing and not clients.owns(sdb, client.id, rid):
        raise HTTPException(409, "A recording with this id belongs to another client")
    fmt = str(m.get("format") or Path(audio.filename or "").suffix.lstrip(".") or "wav").lower()
    folder = c.cfg.recordings_dir / rid
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"audio{EXT.get(fmt, '.' + re.sub(r'[^a-z0-9]', '', fmt)[:5] or '.bin')}"
    size = 0
    with dest.open("wb") as fh:
        while chunk := await audio.read(1 << 20):
            fh.write(chunk)
            size += len(chunk)
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
            mode=m.get("mode") if m.get("mode") in MODES else "meeting", source="recorded", process=False))
    if m.get("context"):
        ms.update_meeting(c.db, rid, context_html=str(m["context"])[:20000])
    clients.record_upload(sdb, client.id, rid, size)
    c.jobs.enqueue(rid)
    return _job_view(rid)


def _owned(request: Request, client: Client, rid: str) -> None:
    if not clients.owns(request.app.state.db, client.id, rid):
        raise HTTPException(404, "Recording not found")


@router.get("/recordings/{rid}")
def status(request: Request, client: ClientDep, rid: str):
    _owned(request, client, rid)
    return _job_view(rid)


@router.get("/recordings/{rid}/result")
def result(request: Request, client: ClientDep, rid: str):
    _owned(request, client, rid)
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
    engine_ctx().jobs.enqueue(rid)
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
