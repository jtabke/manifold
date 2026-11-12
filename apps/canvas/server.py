"""Serve the engineering canvas and its bounded Python plot sampler locally."""

import argparse
import json
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from artifact_sampler import SamplingUnavailable, sample
from assistant_bridge import AssistantBridge, AssistantUnavailable

ROOT = Path(__file__).parent


class Handler(BaseHTTPRequestHandler):
    def send_json(self, data: object, status: int = 200) -> None:
        encoded = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def assistant_request(self, action: str) -> None:
        try:
            host = self.headers.get("Host", "")
            parsed = urlparse(f"http://{host}")
            origin = self.headers.get("Origin")
            bridge = self.server.assistant
            if (parsed.hostname not in ("127.0.0.1", "localhost")
                    or parsed.port not in (self.server.server_port, 58311)
                    or (origin and origin not in bridge.origins)):
                self.send_json({"error": "Use the local canvas origin."}, 403)
                return
            body = None
            if action == "connect":
                length = int(self.headers.get("Content-Length", "0"))
                if (not 0 < length <= 16000
                        or self.headers.get("Content-Type") != "application/json"):
                    raise ValueError("Expected a bounded JSON configuration request")
                body = json.loads(self.rfile.read(length))
            status, result = bridge.request(action, body, origin)
            self.send_json(result, status)
        except (ValueError, TypeError):
            self.send_json({"error": "Choose a provider and model with a valid configuration."}, 400)
        except AssistantUnavailable as error:
            self.send_json({"error": str(error)}, 503)

    def do_POST(self) -> None:
        if self.path == "/api/assistant/connect":
            self.assistant_request("connect")
            return
        if self.path != "/api/artifact-sample":
            self.send_json({"error": "Unknown endpoint"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 131072:
                raise ValueError("Request body must be between 1 and 131072 bytes")
            body = json.loads(self.rfile.read(length))
            origin = self.headers.get("Origin")
            if origin and origin not in (
                f"http://{self.headers.get('Host')}",
                "http://127.0.0.1:58311",
            ):
                raise ValueError("Use the local workspace origin")
            self.send_json(sample(body))
        except SamplingUnavailable as error:
            self.send_json({"error": str(error)}, 503)
        except (ValueError, TypeError) as error:
            self.send_json({"error": str(error)}, 400)

    def do_GET(self) -> None:
        requested = urlparse(self.path).path
        if requested == "/api/assistant/configuration":
            self.assistant_request("configuration")
            return
        if requested == "/api/health":
            self.send_json({"status": "ready", "evaluator": "bounded Python plot sampler"})
            return
        if requested.startswith("/api/"):
            self.send_json({"error": "Unknown endpoint"}, 404)
            return
        root = (ROOT / "dist").resolve()
        target = (root / requested.lstrip("/")).resolve()
        if not target.is_relative_to(root):
            self.send_error(403)
            return
        if not target.is_file():
            target = root / "index.html"
        if not target.is_file():
            self.send_error(503, "Build the frontend first: npm ci && npm run build")
            return
        import mimetypes

        content = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "text/plain")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


class CanvasServer(ThreadingHTTPServer):
    def __init__(self, address, handler=Handler):
        super().__init__(address, handler)
        self.assistant = AssistantBridge(self.server_port)

    def server_close(self):
        bridge = getattr(self, "assistant", None)
        if bridge:
            bridge.close()
        super().server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=58310)
    args = parser.parse_args()
    server = CanvasServer(("127.0.0.1", args.port))
    print(f"Manifold canvas: http://127.0.0.1:{server.server_port}", flush=True)
    def stop(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
