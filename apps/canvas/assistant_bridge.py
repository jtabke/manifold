"""Own one optional local Node companion; credentials never enter logs or saved work."""

import json
import selectors
import shutil
import subprocess
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


class AssistantUnavailable(RuntimeError):
    pass


class AssistantBridge:
    def __init__(self, port):
        self.port = port
        self.process = None
        self.url = None
        self.lock = threading.Lock()
        self.closed = False

    def _stop(self):
        process, self.process = self.process, None
        self.url = None
        if process:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if process.stdout:
                process.stdout.close()

    def _start(self):
        if self.closed:
            raise AssistantUnavailable("Canvas server is closing.")
        if self.process and self.process.poll() is None:
            return self.url
        self._stop()
        node = shutil.which("node")
        if not node:
            raise AssistantUnavailable(
                "Node.js is required for the assistant. "
                "Install Node 22.18+ and restart Manifold."
            )
        args = [node, str(ROOT / "apps/assistant/src/main.mjs"), "--managed", "--port", "0"]
        for origin in self.origins:
            args.extend(["--origin", origin])
        try:
            self.process = subprocess.Popen(
                args, cwd=ROOT, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=20):
                    raise ValueError("Startup timed out")
                line = self.process.stdout.readline(4096)
            endpoint = json.loads(line)["url"]
            parsed = urlparse(endpoint)
            if parsed.scheme != "ws" or parsed.hostname != "127.0.0.1" or not parsed.port:
                raise ValueError("Invalid companion endpoint")
            self.url = endpoint
            return endpoint
        except (OSError, ValueError, KeyError):
            self._stop()
            raise AssistantUnavailable(
                "Assistant could not start. Check Node.js and run npm ci in the Manifold checkout."
            ) from None

    @property
    def origins(self):
        return [
            f"http://{host}:{port}"
            for host in ("127.0.0.1", "localhost")
            for port in {self.port, 58311}
        ]

    def request(self, path, body=None, origin=None):
        with self.lock:
            endpoint = self._start()
        parsed = urlparse(endpoint)
        url = f"http://{parsed.netloc}/{path}?{parsed.query}"
        headers = {
            "Origin": origin or f"http://127.0.0.1:{self.port}",
            "Content-Type": "application/json",
        }
        data = json.dumps(body).encode() if body is not None else None
        request = Request(
            url, data=data, headers=headers,
            method="POST" if body is not None else "GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read(4 * 1024 * 1024))
        except HTTPError as error:
            try:
                return error.code, json.loads(error.read(16384))
            except (ValueError, OSError):
                pass
        except (OSError, ValueError):
            pass
        raise AssistantUnavailable("Assistant connection failed. Retry when ready.")

    def close(self):
        with self.lock:
            self.closed = True
            self._stop()
