"""Token-paired, loopback-only local dashboard. Python 3.10+."""
from __future__ import annotations
import argparse
import hmac
import json
import mimetypes
import os
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from . import __version__
from .intel import Intel, ROOT
from .store import Store


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, root=ROOT, state_dir=None):
        self.root = root
        state_dir = Path(state_dir or root / "local-data")
        state_dir.mkdir(parents=True, exist_ok=True)
        self.token_path = state_dir / "pairing-key.txt"
        if self.token_path.exists():
            self.token = self.token_path.read_text().strip()
        else:
            self.token = secrets.token_urlsafe(32)
            self.token_path.write_text(self.token, encoding="utf-8")
            try:
                os.chmod(self.token_path, 0o600)
            except OSError:
                pass
        self.intel = Intel(root)
        self.store = Store(state_dir / "ghosttrace.sqlite3", self.intel)
        self.last_seen = 0
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "GhostTrace/" + __version__
    def log_message(self, fmt, *args):
        # URLs and event payloads do not enter access logs.
        pass

    def local_host(self):
        port = self.server.server_address[1]
        return self.headers.get("Host", "") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def origin_ok(self, allow_extension=True):
        origin = self.headers.get("Origin", "")
        port = self.server.server_address[1]
        if not origin or origin in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
            return True
        # CORS is not authentication; every API except /api/setup also requires the secret.
        return allow_extension and origin.startswith("chrome-extension://") and len(origin.removeprefix("chrome-extension://")) == 32

    def authorized(self):
        value = self.headers.get("Authorization", "")
        return hmac.compare_digest(value.encode("utf-8"), ("Bearer " + self.server.token).encode("utf-8"))

    def send(self, data, status=200, kind="application/json; charset=utf-8", extra=None):
        if not isinstance(data, bytes):
            data = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        if self.headers.get("Origin") and self.origin_ok():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def guard(self, secret=True, allow_extension=True):
        if not self.local_host() or not self.origin_ok(allow_extension):
            self.send({"error": "Only local dashboard and paired extension access is allowed"}, 403)
            return False
        if secret and not self.authorized():
            self.send({"error": "Pairing key required"}, 401)
            return False
        return True

    def do_OPTIONS(self):
        if self.guard(secret=False):
            self.send(b"", 204, extra={"Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type"})

    def do_GET(self):
        path = urlsplit(self.path)
        if not self.guard(secret=path.path.startswith("/api/") and path.path != "/api/setup", allow_extension=path.path != "/api/setup"):
            return
        if path.path == "/api/setup":
            # Deny cross-site navigational requests before revealing the pairing secret.
            if self.headers.get("Sec-Fetch-Site", "none") not in {"none", "same-origin"}:
                self.send({"error": "Open the local dashboard directly"}, 403)
                return
            self.send({"key": self.server.token, "version": __version__})
        elif path.path == "/api/status":
            self.send({"version": __version__, "paused": self.server.store.setting("paused", False),
                       "last_seen": self.server.last_seen, "geo": list(self.server.intel.readers),
                       "tracker_domains": len(self.server.intel.trackers), "broker_entries": self.server.intel.broker_count})
        elif path.path == "/api/dashboard":
            params = parse_qs(path.query)
            try:
                self.send(self.server.store.dashboard(hours=params.get("hours", ["1"])[0], site=params.get("site", [""])[0], search=params.get("q", [""])[0], mode=params.get("mode", ["all"])[0]))
            except (ValueError, TypeError):
                self.send({"error": "Invalid filter"}, 400)
        elif path.path == "/api/export":
            self.send(self.server.store.export_csv(), kind="text/csv; charset=utf-8", extra={"Content-Disposition": 'attachment; filename="GhostTrace_connections.csv"'})
        elif path.path.startswith("/api/"):
            self.send({"error": "Unknown endpoint"}, 404)
        else:
            target = self.server.root / "static" / ("index.html" if path.path == "/" else path.path.lstrip("/"))
            try:
                target = target.resolve()
                target.relative_to((self.server.root / "static").resolve())
                data = target.read_bytes()
            except (ValueError, FileNotFoundError, IsADirectoryError):
                self.send({"error": "Not found"}, 404)
                return
            kind = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            self.send(data, kind=kind)

    def do_POST(self):
        if not self.guard():
            return
        path = urlsplit(self.path).path
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 2_000_000:
                self.send({"error": "Invalid or oversized body"}, 413)
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                self.send({"error": "JSON required"}, 415)
                return
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("Expected object")
            if path == "/api/events":
                self.server.last_seen = time.time() * 1000
                paused = self.server.store.setting("paused", False)
                inserted = 0 if paused else self.server.store.ingest(payload.get("events", []))
                self.send({"accepted": inserted, "paused": paused})
            elif path == "/api/heartbeat":
                self.server.last_seen = time.time() * 1000
                self.send({"paused": self.server.store.setting("paused", False)})
            elif path == "/api/settings":
                paused = bool(payload.get("paused", False))
                self.server.store.set_setting("paused", paused)
                self.send({"paused": paused})
            elif path == "/api/clear":
                self.server.store.clear()
                self.send({"cleared": True})
            else:
                self.send({"error": "Unknown endpoint"}, 404)
        except (ValueError, TypeError, json.JSONDecodeError, OverflowError) as error:
            self.send({"error": str(error)[:200]}, 400)


def main():
    parser = argparse.ArgumentParser(description="GhostTrace local dashboard")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    try:
        server = Server(("127.0.0.1", args.port), state_dir=args.data_dir)
    except OSError as error:
        raise SystemExit(f"Could not start GhostTrace: {error}\nClose the other instance, or use --port 8766 and update the extension port.")
    url = f"http://127.0.0.1:{args.port}"
    print(f"GhostTrace {__version__} | {url}\nOpen Pair extension in the dashboard. Press Ctrl+C to stop.\nBrowsing records stay in {server.token_path.parent}")
    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGhostTrace stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
