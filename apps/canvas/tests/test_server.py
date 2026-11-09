"""Exercise the application server without research packages or build artifacts."""

import json
import sys
import threading
import unittest
from unittest.mock import patch
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, body=None, origin=None):
        connection = HTTPConnection(*self.server.server_address, timeout=5)
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        try:
            connection.request(
                method, path, json.dumps(body) if body is not None else None, headers
            )
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_health(self):
        status, result = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "ready")

    def test_bound_plot_sample(self):
        status, result = self.request(
            "POST",
            "/api/artifact-sample",
            {"code": "x = linspace(0, 2, 3)\ny = [v0*a for a in x]", "inputs": {"v0": 3}},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["points"], [[0, 0], [1, 3], [2, 6]])
        self.assertIn("code_sha256", result)

    def test_sampler_launch_failure_is_recoverable(self):
        body = {
            "code": "x = linspace(0, 2, 3)\ny = [v0*a for a in x]",
            "inputs": {"v0": 3},
        }
        with patch("artifact_sampler.subprocess.run", side_effect=OSError("private path")):
            status, result = self.request("POST", "/api/artifact-sample", body)
        self.assertEqual(status, 503)
        self.assertEqual(result, {"error": "Python sampling is unavailable. Retry when ready."})
        status, result = self.request("POST", "/api/artifact-sample", body)
        self.assertEqual(status, 200)
        self.assertEqual(result["points"], [[0, 0], [1, 3], [2, 6]])

    def test_arbitrary_code_rejected(self):
        status, _ = self.request(
            "POST",
            "/api/artifact-sample",
            {"code": "import os", "inputs": {}},
        )
        self.assertEqual(status, 400)

    def test_cross_origin_rejected(self):
        status, _ = self.request(
            "POST",
            "/api/artifact-sample",
            {},
            origin="https://example.com",
        )
        self.assertEqual(status, 400)

    def test_unknown_endpoint(self):
        for method in ("GET", "POST"):
            status, _ = self.request(method, "/api/unknown", {})
            self.assertEqual(status, 404)
