"""Self-signed TLS certificate for servers without a public domain. Generated once, valid for
ten years, served by Caddy; the desktop pins it after the user compares the fingerprint shown
in the dashboard."""
from __future__ import annotations

import datetime as dt
import hashlib
import ipaddress
import socket
from pathlib import Path


def ensure(tls_dir: Path, name: str) -> tuple[Path, Path]:
    cert, key = tls_dir / "server.crt", tls_dir / "server.key"
    if cert.exists() and key.exists():
        return cert, key
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    priv = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name[:60] or "Huddle Server")])
    sans: list[x509.GeneralName] = [x509.DNSName("localhost")]
    try:
        host = socket.gethostname()
        if host:
            sans.append(x509.DNSName(host[:63]))
    except OSError:
        pass
    for ip in ("127.0.0.1",):
        sans.append(x509.IPAddress(ipaddress.ip_address(ip)))
    now = dt.datetime.now(dt.UTC)
    builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(priv.public_key())
               .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(days=1))
               .not_valid_after(now + dt.timedelta(days=3650))
               .add_extension(x509.SubjectAlternativeName(sans), critical=False)
               .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True))
    certificate = builder.sign(priv, hashes.SHA256())
    tls_dir.mkdir(parents=True, exist_ok=True)
    key.write_bytes(priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                       serialization.NoEncryption()))
    key.chmod(0o600)
    cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    return cert, key


def fingerprint(cert_path: Path) -> str | None:
    """SHA-256 of the DER certificate, formatted like the desktop shows it (AA:BB:…)."""
    if not cert_path.exists():
        return None
    import ssl
    der = ssl.PEM_cert_to_DER_cert(cert_path.read_text())
    h = hashlib.sha256(der).hexdigest().upper()
    return ":".join(h[i:i + 2] for i in range(0, len(h), 2))
