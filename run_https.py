from __future__ import annotations

import os
from pathlib import Path

import uvicorn
import mimetypes

# Ensure correct MIME types for JavaScript files on Windows
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")

BASE_DIR = Path(__file__).resolve().parent
CERT_DIR = BASE_DIR / ".certs"
CERT_FILE = CERT_DIR / "dev-cert.pem"
KEY_FILE = CERT_DIR / "dev-key.pem"


def main() -> None:
    if not CERT_FILE.exists() or not KEY_FILE.exists():
        raise SystemExit(
            "HTTPS certificates were not found. Run '.\\scripts\\setup_https.ps1' first."
        )

    host = os.environ.get("GOLF3_HTTPS_HOST", "0.0.0.0")
    port = int(os.environ.get("GOLF3_HTTPS_PORT", "8443"))

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        ssl_certfile=str(CERT_FILE),
        ssl_keyfile=str(KEY_FILE),
    )


if __name__ == "__main__":
    main()