"""Roles, invitations, open registration, per-client scope, scoped MCP and the admin boundary."""
import json
import time

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

H = {"X-Requested-With": "huddle"}
ADMIN = {"email": "dylan@example.com", "password": "correct horse battery"}


def _wav(seconds=1.5):
    import io
    buf = io.BytesIO()
    sf.write(buf, np.zeros(int(16000 * seconds), dtype=np.int16), 16000, format="WAV")
    return buf.getvalue()


def _upload(c, auth, rid, title):
    meta = {"id": rid, "startedAt": time.time(), "durationSec": 1.5, "format": "wav", "title": title}
    r = c.post("/v1/recordings", headers=auth, data={"meta": json.dumps(meta)}, files={"audio": ("a.wav", _wav(), "audio/wav")})
    assert r.status_code == 200, r.text
    for _ in range(100):
        if c.get(f"/v1/recordings/{rid}", headers=auth).json()["state"] in ("ready", "failed"):
            break
        time.sleep(0.1)


def _second_client(client):
    """A second browser session (own cookie jar) against the same app."""
    return TestClient(client.app)


def test_invite_flow_and_user_boundary(admin):
    a = admin
    # invitation link → active account with role user
    assert a.post("/api/invites", json={"email": "blep"}, headers=H).status_code == 400
    inv = a.post("/api/invites", json={"email": "friend@example.com"}, headers=H).json()
    assert inv["token"] and "/join/" in inv["url"]
    listed = a.get("/api/invites").json()[0]
    assert listed["used"] is False and listed["url"] == inv["url"]      # copyable again while open
    u = _second_client(a)
    assert u.get(f"/api/auth/invite/{inv['token']}").json() == {"valid": True, "email": "friend@example.com"}
    r = u.post("/api/auth/register", json={"name": "Other", "email": "other@example.com", "password": "ten chars long!", "invite": inv["token"]}, headers=H)
    assert r.status_code == 400 and "another e-mail" in r.json()["detail"]
    r = u.post("/api/auth/register", json={"name": "Friend", "email": "friend@example.com", "password": "ten chars long!", "invite": inv["token"]}, headers=H)
    assert r.status_code == 200 and r.json()["pending"] is False and r.json()["user"]["role"] == "user"
    assert a.get("/api/invites").json()[0]["used"] is True and a.get("/api/invites").json()[0]["url"] is None
    assert u.get(f"/api/auth/invite/{inv['token']}").json()["valid"] is False   # single use

    # the user cannot reach admin things
    for path in ("/api/overview", "/api/users", "/api/invites", "/engine/settings", "/engine/meetings", "/engine/system/environment"):
        assert u.get(path).status_code == 403, path
    assert u.put("/engine/settings", json={"privacy.retentionDays": 1}, headers=H).status_code == 403
    assert u.post("/engine/privacy/delete-all-meetings", headers=H).status_code == 403
    assert u.put("/api/server", json={"name": "Hacked"}, headers=H).status_code == 403
    assert u.post("/api/invites", json={}, headers=H).status_code == 403

    # the user's own client, scope own by default and not changeable by the user
    k = u.post("/api/clients", json={"name": "Friend's Mac"}, headers=H).json()
    assert k["scope"] == "own"
    assert u.patch(f"/api/clients/{k['id']}", json={"scope": "all"}, headers=H).status_code == 403
    assert u.patch(f"/api/clients/{k['id']}", json={"ai_enabled": False}, headers=H).json()["aiEnabled"] is False   # the owner decides
    assert "transcription" in u.get("/api/capabilities").json()
    assert u.get("/api/auth/me").json()["user"]["totpPrompted"] is False
    assert u.post("/api/account/totp-prompted", headers=H).status_code == 200 and u.get("/api/auth/me").json()["user"]["totpPrompted"] is True
    assert u.patch(f"/api/clients/{k['id']}", json={"name": "Renamed"}, headers=H).json()["name"] == "Renamed"
    # the admin sees it with its owner; the user sees only their own
    assert any(c["id"] == k["id"] and c["userEmail"] == "friend@example.com" for c in a.get("/api/clients").json())
    assert {c["id"] for c in u.get("/api/clients").json()} == {k["id"]}
    # an admin's client is out of the user's reach
    ak = a.post("/api/clients", json={"name": "Admin Mac"}, headers=H).json()
    assert u.get(f"/api/clients/{ak['id']}/mcp-tokens").status_code == 404
    assert u.post(f"/api/clients/{ak['id']}/revoke", headers=H).status_code == 404

    # meetings: each account sees its own; admin sees all; scope all opens everything
    fa = {"Authorization": f"Bearer {k['key']}"}
    aa = {"Authorization": f"Bearer {ak['key']}"}
    _upload(a, fa, "friend-rec-000001", "Friend's recording")
    _upload(a, aa, "admin-rec-0000001", "Admin's recording")
    assert {m["id"] for m in u.get("/api/meetings").json()} == {"friend-rec-000001"}
    assert u.get("/api/meetings/admin-rec-0000001").status_code == 404
    assert u.get("/api/meetings/admin-rec-0000001/audio").status_code == 404
    assert u.delete("/api/meetings/admin-rec-0000001", headers=H).status_code == 404
    assert {"friend-rec-000001", "admin-rec-0000001"} <= {m["id"] for m in a.get("/api/meetings").json()}
    assert u.get("/api/meetings/friend-rec-000001").json()["ownerUserId"] == u.get("/api/auth/me").json()["user"]["id"]
    assert [h["meetingId"] for h in u.get("/api/search?q=Hallo").json()] == ["friend-rec-000001"]
    a.patch(f"/api/clients/{k['id']}", json={"scope": "all"}, headers=H)
    assert u.get("/api/auth/me").json()["canSeeAll"] is True
    assert u.get("/api/meetings/admin-rec-0000001").status_code == 200
    assert u.delete("/api/meetings/admin-rec-0000001", headers=H).status_code == 403    # read-only on others' recordings
    assert u.post("/api/meetings/admin-rec-0000001/delete-audio", headers=H).status_code == 403
    a.patch(f"/api/clients/{k['id']}", json={"scope": "own"}, headers=H)

    # admin user management
    users = a.get("/api/users").json()
    friend = next(x for x in users if x["email"] == "friend@example.com")
    assert friend["clientCount"] == 1
    me_id = a.get("/api/auth/me").json()["user"]["id"]
    assert a.patch(f"/api/users/{me_id}", json={"role": "user"}, headers=H).status_code == 400   # not your own admin role
    assert a.patch(f"/api/users/{friend['id']}", json={"role": "admin"}, headers=H).json()["role"] == "admin"
    assert a.patch(f"/api/users/{friend['id']}", json={"role": "user"}, headers=H).json()["role"] == "user"
    assert a.post(f"/api/users/{friend['id']}/password", json={"password": "a brand new password"}, headers=H).status_code == 200
    assert u.get("/api/auth/me").json()["user"] is None   # sessions dropped after the reset
    assert u.post("/api/auth/login", json={"email": "friend@example.com", "password": "a brand new password"}, headers=H).status_code == 200


def test_open_registration_waits_for_approval(admin):
    a = admin
    u = _second_client(a)
    r = u.post("/api/auth/register", json={"name": "Walk-in", "email": "walkin@example.com", "password": "ten chars long!"}, headers=H)
    assert r.status_code == 400 and "invitation" in r.json()["detail"]
    a.put("/api/server", json={"registration": "open"}, headers=H)
    assert u.get("/api/setup").json()["registration"] == "open"
    r = u.post("/api/auth/register", json={"name": "Walk-in", "email": "walkin@example.com", "password": "ten chars long!"}, headers=H)
    assert r.status_code == 200 and r.json()["pending"] is True and r.json()["user"] is None
    r = u.post("/api/auth/login", json={"name": "Walk-in", "email": "walkin@example.com", "password": "ten chars long!"}, headers=H)
    assert r.status_code == 401 and "approval" in r.json()["detail"]
    pending = next(x for x in a.get("/api/users").json() if x["email"] == "walkin@example.com")
    assert pending["approved"] is False and a.get("/api/overview").json()["pendingUsers"] == 1
    a.patch(f"/api/users/{pending['id']}", json={"approved": True}, headers=H)
    assert u.post("/api/auth/login", json={"name": "Walk-in", "email": "walkin@example.com", "password": "ten chars long!"}, headers=H).status_code == 200
    a.delete(f"/api/users/{pending['id']}", headers=H)
    assert u.get("/api/auth/me").json()["user"] is None
    a.put("/api/server", json={"registration": "invite"}, headers=H)


def _mcp_call(c, token, name, args=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}}
    r = c.post("/mcp", json=body, headers={"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream",
                                          "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    if res.get("isError"):
        return {"error": res["content"][0]["text"]}
    sc = res.get("structuredContent")
    if sc is not None:
        return sc["result"] if isinstance(sc, dict) and set(sc) == {"result"} else sc
    return json.loads(res["content"][0]["text"])


def test_mcp_tokens_follow_the_client_scope(admin):
    a = admin
    own = a.post("/api/clients", json={"name": "Scoped Mac"}, headers=H).json()
    wide = a.post("/api/clients", json={"name": "Wide Mac"}, headers=H).json()
    a.patch(f"/api/clients/{wide['id']}", json={"scope": "all"}, headers=H)
    _upload(a, {"Authorization": f"Bearer {own['key']}"}, "scoped-rec-000001", "Scoped recording")
    _upload(a, {"Authorization": f"Bearer {wide['key']}"}, "wide-rec-00000001", "Wide recording")

    # made from the desktop with the client key …
    t_own = a.post("/v1/mcp-tokens", headers={"Authorization": f"Bearer {own['key']}"}, json={"name": "Claude Code", "days": 30}).json()
    assert t_own["token"].startswith("hmt_") and t_own["url"].endswith("/mcp") and t_own["scope"] == "own"
    # … or from the dashboard for one of your clients
    t_wide = a.post(f"/api/clients/{wide['id']}/mcp-tokens", json={"name": "Cursor"}, headers=H).json()
    assert t_wide["scope"] == "all"
    assert len(a.get(f"/api/clients/{own['id']}/mcp-tokens").json()) == 1

    assert a.post("/mcp", json={}, headers={"Accept": "application/json, text/event-stream"}).status_code == 401
    ids_own = {m["meetingId"] for m in _mcp_call(a, t_own["token"], "list_meetings")}
    assert ids_own == {"scoped-rec-000001"}
    ids_wide = {m["meetingId"] for m in _mcp_call(a, t_wide["token"], "list_meetings")}
    assert {"scoped-rec-000001", "wide-rec-00000001"} <= ids_wide
    assert _mcp_call(a, t_own["token"], "get_summary", {"meeting_id": "scoped-rec-000001"})["summary"] == "Samenvatting."
    denied = _mcp_call(a, t_own["token"], "get_summary", {"meeting_id": "wide-rec-00000001"})
    assert "error" in denied
    hits = _mcp_call(a, t_own["token"], "search_transcripts", {"query": "Hallo"})
    assert {h["meetingId"] for h in hits} == {"scoped-rec-000001"}
    hits = _mcp_call(a, t_wide["token"], "search_transcripts", {"query": "Hallo"})
    assert {"scoped-rec-000001", "wide-rec-00000001"} <= {h["meetingId"] for h in hits}
    seg = _mcp_call(a, t_own["token"], "get_transcript", {"meeting_id": "scoped-rec-000001"})[0]["segmentId"]
    assert _mcp_call(a, t_own["token"], "get_transcript_context", {"segment_id": seg})[0]["meetingId"] == "scoped-rec-000001"
    wide_seg = _mcp_call(a, t_wide["token"], "get_transcript", {"meeting_id": "wide-rec-00000001"})[0]["segmentId"]
    assert "error" in json.dumps(_mcp_call(a, t_own["token"], "get_transcript_context", {"segment_id": wide_seg})).lower()

    # revoking the client revokes its tokens; deleting a token works from the desktop too
    a.post(f"/api/clients/{wide['id']}/revoke", headers=H)
    assert all(t["revoked"] for t in a.get(f"/api/clients/{wide['id']}/mcp-tokens").json())
    r = a.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers={"Authorization": f"Bearer {t_wide['token']}", "Accept": "application/json, text/event-stream"})
    assert r.status_code == 401
    assert a.delete(f"/v1/mcp-tokens/{t_own['id']}", headers={"Authorization": f"Bearer {own['key']}"}).json()["ok"] is True
    assert _mcp_call.__name__ and a.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers={"Authorization": f"Bearer {t_own['token']}", "Accept": "application/json, text/event-stream"}).status_code == 401


def test_browser_recording_and_account_name(admin):
    a = admin
    assert a.get("/api/auth/me").json()["user"]["name"] == "Dylan"
    assert a.patch("/api/account", json={"name": "Dylan K."}, headers=H).json()["name"] == "Dylan K."
    meta = {"id": "browser-rec-000001", "startedAt": time.time(), "durationSec": 1.5, "format": "wav", "title": "From the browser"}
    r = a.post("/api/record", data={"meta": json.dumps(meta)}, files={"audio": ("rec.wav", _wav(), "audio/wav")}, headers=H)
    assert r.status_code == 200, r.text
    for _ in range(100):
        if a.get("/api/meetings/browser-rec-000001").json()["meeting"]["status"] in ("ready", "failed"):
            break
        time.sleep(0.1)
    d = a.get("/api/meetings/browser-rec-000001").json()
    assert d["meeting"]["status"] == "ready" and d["meeting"]["title"] == "From the browser"
    browser = next(c for c in a.get("/api/clients").json() if c["kind"] == "browser")
    assert browser["meetingCount"] >= 1 and browser["key"] is None
    tools = a.get("/api/mcp/tools").json()
    assert any(t["name"] == "search_transcripts" for t in tools)


def test_projects_speakers_and_action_items_are_per_account(admin):
    a = admin
    u = _second_client(a)
    inv = a.post("/api/invites", json={}, headers=H).json()
    u.post("/api/auth/register", json={"name": "Pat", "email": "pat@example.com", "password": "ten chars long!", "invite": inv["token"]}, headers=H)
    pk = u.post("/api/clients", json={"name": "Pat's Mac"}, headers=H).json()
    _upload(u, {"Authorization": f"Bearer {pk['key']}"}, "pat-rec-00000001", "Pat's recording")

    # projects live per account; meetings are filed only by their owner
    p = u.post("/api/projects", json={"name": "Garden"}, headers=H).json()
    assert u.get("/api/projects").json()[0]["name"] == "Garden"
    assert all(x["name"] != "Garden" for x in a.get("/api/projects").json())
    assert a.get(f"/api/projects/{p['id']}").status_code == 404
    assert u.put("/api/meetings/pat-rec-00000001/project", json={"project_id": p["id"]}, headers=H).json()["projectId"] == p["id"]
    assert [m["id"] for m in u.get(f"/api/projects/{p['id']}").json()["meetings"]] == ["pat-rec-00000001"]
    assert u.post("/api/projects", json={"name": "garden"}, headers=H).status_code == 400     # same name, same account
    assert a.post("/api/projects", json={"name": "Garden"}, headers=H).status_code == 200      # another account may reuse it

    # naming a speaker enrols the voice for this account only
    d = u.get("/api/meetings/pat-rec-00000001").json()
    sp = d["speakers"][0]
    r = u.post("/api/meetings/pat-rec-00000001/speakers/rename", json={"meeting_speaker_id": sp["id"], "name": "Pat", "enroll": True}, headers=H)
    assert r.status_code == 200 and r.json()["displayName"] == "Pat"
    assert [v["name"] for v in u.get("/api/speakers").json()] == ["Pat"]
    assert all(v["name"] != "Pat" for v in a.get("/api/speakers").json())
    assert a.post("/api/meetings/pat-rec-00000001/speakers/rename", json={"meeting_speaker_id": sp["id"], "name": "X"}, headers=H).status_code in (200, 403)

    # action items follow visibility
    it = u.post("/api/meetings/pat-rec-00000001/action-items", json={"text": "Water the plants"}, headers=H).json()
    assert any(x["id"] == it["id"] for x in u.get("/api/action-items").json())
    assert u.patch(f"/api/action-items/{it['id']}", json={"done": True}, headers=H).json()["done"] is True
    assert a.get("/api/processes").status_code == 200 and u.get("/api/processes").status_code == 403
    assert u.get("/api/files").status_code == 403
    files = a.get("/api/files").json()
    assert any(e["name"] == "recordings" and e["kind"] == "folder" for e in files["entries"])
    assert a.get("/api/files?path=../..").status_code == 400
    rec = a.get("/api/files?path=recordings/pat-rec-00000001").json()
    assert any(e["name"].startswith("audio") for e in rec["entries"]) and any(e["name"] == "meeting.json" for e in rec["entries"])
    assert a.get("/api/files/download?path=recordings/pat-rec-00000001/meeting.json").status_code == 200
    assert a.get("/api/files/download?path=huddle.db").status_code == 200
    assert a.delete("/api/files?path=huddle.db", headers=H).status_code == 400
    assert u.post("/api/meetings/pat-rec-00000001/process", json={"language_override": "nl", "speaker_count": 2, "mode": "interview"}, headers=H).status_code == 200
    d = u.get("/api/meetings/pat-rec-00000001").json()["meeting"]
    assert d["languageOverride"] == "nl" and d["speakerCountHint"] == 2 and d["mode"] == "interview"
    assert u.post("/api/ask", json={"question": "anything"}, headers=H).status_code == 403
