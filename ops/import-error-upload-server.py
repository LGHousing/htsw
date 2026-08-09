#!/usr/bin/env python3
from __future__ import annotations

import ipaddress
import json
import os
import secrets
import shutil
import socket
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 37124
DEST_DIR = Path("/var/lib/htsw/import-errors")
INDEX_PATH = DEST_DIR / "index.jsonl"
MAX_BYTES = 24 * 1024 * 1024
MAX_STORED_BYTES = 4 * 1024 * 1024 * 1024
MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
READ_TIMEOUT_SECONDS = 20
RATE_WINDOW_SECONDS = 10 * 60
MAX_UPLOADS_PER_CLIENT = 12
MAX_UPLOADS_GLOBAL = 60
MAX_CONCURRENT_REQUESTS = 8

_state_lock = threading.Lock()
_client_uploads: defaultdict[str, deque[float]] = defaultdict(deque)
_global_uploads: deque[float] = deque()
_stored_bytes: int | None = None


def _prune_attempts(attempts: deque[float], now: float) -> None:
    cutoff = now - RATE_WINDOW_SECONDS
    while attempts and attempts[0] <= cutoff:
        attempts.popleft()


def _allow_upload(client: str) -> bool:
    now = time.monotonic()
    with _state_lock:
        _prune_attempts(_global_uploads, now)
        if not _global_uploads:
            for known_client, known_attempts in list(_client_uploads.items()):
                _prune_attempts(known_attempts, now)
                if not known_attempts:
                    del _client_uploads[known_client]
        if len(_global_uploads) >= MAX_UPLOADS_GLOBAL:
            return False
        attempts = _client_uploads[client]
        _prune_attempts(attempts, now)
        if len(attempts) >= MAX_UPLOADS_PER_CLIENT:
            return False
        _global_uploads.append(now)
        attempts.append(now)
        return True


def _stored_report_bytes() -> int:
    global _stored_bytes
    if _stored_bytes is None:
        _stored_bytes = sum(
            path.stat().st_size for path in DEST_DIR.glob("*.json") if path.is_file()
        )
    return _stored_bytes


def _write_report(target: Path, payload: bytes, summary: dict[str, object]) -> bool:
    global _stored_bytes
    with _state_lock:
        DEST_DIR.mkdir(parents=True, exist_ok=True)
        if _stored_report_bytes() + len(payload) > MAX_STORED_BYTES:
            return False
        if shutil.disk_usage(DEST_DIR).free - len(payload) < MIN_FREE_BYTES:
            return False

        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as report:
                report.write(payload)
        except Exception:
            target.unlink(missing_ok=True)
            raise

        try:
            with INDEX_PATH.open("a", encoding="utf-8") as index:
                index.write(json.dumps(summary, sort_keys=True) + "\n")
            INDEX_PATH.chmod(0o600)
        except Exception:
            target.unlink(missing_ok=True)
            raise

        _stored_bytes = _stored_report_bytes() + len(payload)
        return True


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = MAX_CONCURRENT_REQUESTS

    def __init__(
        self,
        server_address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
    ) -> None:
        super().__init__(server_address, handler)
        self._worker_slots = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)

    def process_request(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        self._worker_slots.acquire()
        try:
            super().process_request(request, client_address)
        except Exception:
            self._worker_slots.release()
            raise

    def process_request_thread(
        self, request: socket.socket, client_address: tuple[str, int]
    ) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._worker_slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "HTSWImportErrorUpload/1.0"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(READ_TIMEOUT_SECONDS)

    def client_identity(self) -> str:
        forwarded = self.headers.get("CF-Connecting-IP", "").strip()
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            return self.client_address[0]

    def do_POST(self) -> None:
        if self.path != "/upload":
            self.send_error(404)
            return

        if self.headers.get("Transfer-Encoding") is not None:
            self.send_error(400, "transfer encoding is not supported")
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415, "expected application/json")
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

        if not _allow_upload(self.client_identity()):
            self.send_response(429)
            self.send_header("Retry-After", str(RATE_WINDOW_SECONDS))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        try:
            raw = self.rfile.read(length)
        except (TimeoutError, socket.timeout):
            self.send_error(408, "request body timed out")
            return
        if len(raw) != length:
            self.send_error(400, "incomplete body")
            return
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

        target = DEST_DIR / name
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
        try:
            payload = (json.dumps(parsed, indent=2, sort_keys=True) + "\n").encode("utf-8")
        except (RecursionError, ValueError):
            self.send_error(400, "invalid json structure")
            return
        try:
            stored = _write_report(target, payload, summary)
        except OSError:
            self.send_error(507, "could not store diagnostics")
            return
        if not stored:
            self.send_error(507, "diagnostics storage is full")
            return

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
    server = Server((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
