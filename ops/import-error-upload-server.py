#!/usr/bin/env python3
from __future__ import annotations

import json
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 37124
DEST_DIR = Path("/var/lib/htsw/import-errors")
INDEX_PATH = DEST_DIR / "index.jsonl"
MAX_BYTES = 24 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "HTSWImportErrorUpload/1.0"

    def do_POST(self) -> None:
        if self.path != "/upload":
            self.send_error(404)
            return

        length_header = self.headers.get("Content-Length")
        try:
            length = int(length_header or "0")
        except ValueError:
            self.send_error(400, "invalid content length")
            return

        if length <= 0:
            self.send_error(400, "empty body")
            return
        if length > MAX_BYTES:
            self.send_error(413, "body too large")
            return

        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_error(400, "invalid json")
            return

        if not isinstance(parsed, dict):
            self.send_error(400, "expected object")
            return

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        upload_id = f"{int(time.time())}-{secrets.token_urlsafe(18)}"
        name = f"{upload_id}.json"
        parsed.setdefault("uploadedAt", now)
        parsed.setdefault("upload", {})
        if isinstance(parsed["upload"], dict):
            parsed["upload"]["id"] = upload_id

        DEST_DIR.mkdir(parents=True, exist_ok=True)
        target = DEST_DIR / name
        target.write_text(json.dumps(parsed, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        target.chmod(0o600)

        summary = {
            "id": upload_id,
            "file": str(target),
            "uploadedAt": now,
            "htswVersion": parsed.get("htswVersion"),
            "context": parsed.get("context"),
            "errorMessage": (parsed.get("error") or {}).get("message")
            if isinstance(parsed.get("error"), dict)
            else None,
        }
        with INDEX_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(summary, sort_keys=True) + "\n")
        INDEX_PATH.chmod(0o600)

        self.send_json(201, {"id": upload_id})

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        self.send_error(404)

    def send_json(self, status: int, body: dict[str, object]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        print(format % args, flush=True)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
