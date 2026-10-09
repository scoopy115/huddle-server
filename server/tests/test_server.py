import io
import time

import numpy as np
import pyotp
import soundfile as sf

H = {"X-Requested-With": "huddle"}


def _wav_bytes(seconds=2.0):
    buf = io.BytesIO()
    sf.write(buf, np.zeros(int(16000 * seconds), dtype=np.int16), 16000, format="WAV")
    return buf.getvalue()


def test_setup_then_login_flow(admin):
    c = admin
    assert c.get("/api/setup").json()["needsSetup"] is False
    assert c.post("/api/setup", json={"name": "X", "email": "x@example.com", "password": "another password"}, headers={"X-Requested-With": "huddle"}).status_code == 403
    me = c.get("/api/auth/me").json()
    assert me["user"]["email"] == "dylan@example.com" and me["user"]["role"] == "admin" and me["totpRequired"] is False
    assert me["canSeeAll"] is True and me["registration"] == "invite"
    # engine routes are behind the session
    assert c.get("/engine/settings").status_code == 200
    assert c.put("/engine/settings", json={"privacy.retentionDays": 30}).status_code == 403   # no CSRF header
    assert c.put("/engine/settings", json={"privacy.retentionDays": 30}, headers=H).status_code == 200
    # logged out → 401
    c.post("/api/auth/logout", headers=H)
    assert c.get("/engine/settings").status_code == 401
    assert c.post("/api/auth/login", json={"email": "dylan@example.com", "password": "wrong"}, headers=H).status_code == 401
    r = c.post("/api/auth/login", json={"email": "dylan@example.com", "password": "correct horse battery"}, headers=H)
    assert r.status_code == 200 and r.json()["user"]


def test_totp_enrolment_and_login(admin):
    c = admin
    setup = c.post("/api/account/totp/setup", headers=H).json()
    assert setup["uri"].startswith("otpauth://totp/") and "<svg" in setup["svg"]
    assert c.post("/api/account/totp/enable", json={"code": "000000"}, headers=H).status_code == 400
    code = pyotp.TOTP(setup["secret"]).now()
    assert c.post("/api/account/totp/enable", json={"code": code}, headers=H).status_code == 200
    c.post("/api/auth/logout", headers=H)
    r = c.post("/api/auth/login", json={"email": "dylan@example.com", "password": "correct horse battery"}, headers=H)
    assert r.json()["user"] is None and r.json()["totpRequired"] is True
    assert c.get("/engine/settings").status_code == 401            # password alone is not enough
    assert c.post("/api/auth/totp", json={"code": "123456"}, headers=H).status_code == 401
    r = c.post("/api/auth/totp", json={"code": pyotp.TOTP(setup["secret"]).now()}, headers=H)
    assert r.status_code == 200 and r.json()["user"]["totpEnabled"] is True
    assert c.get("/engine/settings").status_code == 200
    c.post("/api/account/totp/disable", json={"code": pyotp.TOTP(setup["secret"]).now()}, headers=H)


def test_client_key_lifecycle_and_upload(admin):
    c = admin
    assert c.get("/v1/ping").status_code == 401
    k = c.post("/api/clients", json={"name": "MacBook"}, headers=H).json()
    assert k["key"].startswith("hsk_") and k["prefix"] == k["key"][:12]
    auth = {"Authorization": f"Bearer {k['key']}", "X-Huddle-Client-Version": "0.9.0"}
    ping = c.get("/v1/ping", headers=auth).json()
    assert ping["name"] == "Test Server" and ping["client"] == "MacBook" and "capabilities" in ping
    listed = c.get("/api/clients").json()
    mine = next(x for x in listed if x["id"] == k["id"])
    assert mine["lastVersion"] == "0.9.0" and mine["key"] is None and mine["scope"] == "own" and mine["userEmail"] == "dylan@example.com"

    meta = {"id": "20261009-090000-abc123", "startedAt": 1_760_000_000, "durationSec": 2.0, "format": "wav", "mode": "interview",
            "title": "Testgesprek", "context": "Sanne is de interviewer."}
    r = c.post("/v1/recordings", headers=auth, data={"meta": __import__("json").dumps(meta)},
               files={"audio": ("upload.wav", _wav_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    for _ in range(100):
        st = c.get(f"/v1/recordings/{rid}", headers=auth).json()
        if st["state"] in ("ready", "failed"):
            break
        time.sleep(0.1)
    assert st["state"] == "ready", st
    bundle = c.get(f"/v1/recordings/{rid}/result", headers=auth).json()
    assert bundle["version"] == 1 and len(bundle["segments"]) == 2 and bundle["notes"]["summary"] == "Samenvatting."
    assert bundle["meeting"]["title"] == "Testgesprek" and bundle["meeting"]["mode"] == "interview"
    assert bundle["speakers"][0]["embedding"] == [1.0, 0.0]
    # the dashboard sees it through its own meeting endpoints (admins may also use /engine)
    assert any(m["id"] == rid for m in c.get("/api/meetings").json())
    assert c.get(f"/api/meetings/{rid}").json()["meeting"]["contextHtml"] == "Sanne is de interviewer."
    assert c.get(f"/engine/meetings/{rid}").status_code == 200

    # another client cannot see or claim it
    k2 = c.post("/api/clients", json={"name": "Phone"}, headers=H).json()
    auth2 = {"Authorization": f"Bearer {k2['key']}"}
    assert c.get(f"/v1/recordings/{rid}", headers=auth2).status_code == 404
    r = c.post("/v1/recordings", headers=auth2, data={"meta": __import__("json").dumps(meta)},
               files={"audio": ("upload.wav", _wav_bytes(), "audio/wav")})
    assert r.status_code == 409

    # a client with scope "all" sees it, and may read status/result but not change it
    c.patch(f"/api/clients/{k2['id']}", json={"scope": "all"}, headers=H)
    assert c.get(f"/v1/recordings/{rid}", headers=auth2).status_code == 200
    assert c.get(f"/v1/recordings/{rid}/result", headers=auth2).status_code == 200
    assert c.post(f"/v1/recordings/{rid}/cancel", headers=auth2).status_code == 404
    wide = {m["id"]: m for m in c.get("/v1/recordings", headers=auth2).json()}
    assert rid in wide and wide[rid]["own"] is False
    assert [m["id"] for m in c.get("/v1/recordings", headers=auth).json()] == [rid] and c.get("/v1/recordings", headers=auth).json()[0]["own"] is True
    c.patch(f"/api/clients/{k2['id']}", json={"scope": "own"}, headers=H)
    assert c.get("/v1/recordings", headers=auth2).json() == []

    # revoked → gone
    c.post(f"/api/clients/{k['id']}/revoke", headers=H)
    assert c.get("/v1/ping", headers=auth).status_code == 401
    assert c.get("/api/overview").json()["clients"] >= 1


def test_info_has_fingerprint_and_nothing_else(admin):
    info = admin.get("/api/info").json()
    assert info["name"] == "Test Server" and len(info["fingerprint"]) == 95 and "version" not in info
    assert admin.get("/health").json() == {"ok": True}
    r = admin.get("/api/auth/me")
    assert r.headers["x-frame-options"] == "DENY" and r.headers["cache-control"] == "no-store"
    assert admin.get("/").headers["content-security-policy"].startswith("default-src 'self'")


def test_bad_upload_rejected(admin):
    c = admin
    k = c.post("/api/clients", json={"name": "X"}, headers=H).json()
    auth = {"Authorization": f"Bearer {k['key']}"}
    assert c.post("/v1/recordings", headers=auth, data={"meta": "{bad"}, files={"audio": ("a.wav", b"xx", "audio/wav")}).status_code == 400
    assert c.post("/v1/recordings", headers=auth, data={"meta": '{"id": "../x"}'}, files={"audio": ("a.wav", b"xx", "audio/wav")}).status_code == 400
    assert c.post("/v1/recordings", headers=auth, data={"meta": '{"id": "okid1234"}'}, files={"audio": ("a.wav", b"xx", "audio/wav")}).status_code == 400
