"""Exercise the application server without research packages or build artifacts."""

import json
import sys
import threading
import unittest
from unittest.mock import patch
from http.client import HTTPConnection
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import CanvasServer


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = CanvasServer(("127.0.0.1", 0))
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

    def test_occupied_port_preserves_the_bind_error(self):
        with self.assertRaises(OSError):
            CanvasServer(self.server.server_address)

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

    def test_assistant_configuration_uses_owned_bridge(self):
        config = {"defaultProvider": "test", "defaultModel": "small", "providers": []}
        with patch.object(self.server.assistant, "request", return_value=(200, config)) as request:
            status, result = self.request("GET", "/api/assistant/configuration")
            self.assertEqual(status, 200)
            self.assertEqual(result, config)
            request.assert_called_once_with("configuration", None, None)

    def test_assistant_connect_does_not_log_or_save_configuration(self):
        body = {"provider": "test", "model": "small", "apiKey": "test-key-not-a-secret"}
        with patch.object(self.server.assistant, "request", return_value=(200, {"url": "ws://127.0.0.1:1/"})) as request:
            status, _ = self.request("POST", "/api/assistant/connect", body)
            self.assertEqual(status, 200)
            request.assert_called_once_with("connect", body, None)

    def test_assistant_rejects_cross_origin_before_startup(self):
        with patch.object(self.server.assistant, "request") as request:
            for method, path in (("GET", "/api/assistant/configuration"), ("POST", "/api/assistant/connect")):
                status, _ = self.request(method, path, {}, origin="https://example.com")
                self.assertEqual(status, 403)
            request.assert_not_called()

    def test_missing_node_is_recoverable(self):
        with patch("assistant_bridge.shutil.which", return_value=None):
            status, result = self.request("GET", "/api/assistant/configuration")
            self.assertEqual(status, 503)
            self.assertIn("Node.js", result["error"])
        self.assertEqual(self.request("GET", "/api/health")[0], 200)

    def test_custom_dev_port_preserves_exact_origin_checks(self):
        server = CanvasServer(("127.0.0.1", 0), dev_port=58411)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertIn("http://127.0.0.1:58411", server.assistant.origins)
            self.assertNotIn("http://127.0.0.1:58311", server.assistant.origins)
            for origin, expected in (("http://127.0.0.1:58411", 200),
                                     ("http://localhost:58411", 200),
                                     ("http://127.0.0.1:58311", 403),
                                     ("https://example.com", 403)):
                connection = HTTPConnection(*server.server_address, timeout=5)
                try:
                    with patch.object(server.assistant, "request", return_value=(200, {})) as request:
                        connection.request("GET", "/api/assistant/configuration", headers={"Origin": origin})
                        response = connection.getresponse()
                        self.assertEqual(response.status, expected)
                        response.read()
                        self.assertEqual(request.called, expected == 200)
                finally:
                    connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_unknown_endpoint(self):
        for method in ("GET", "POST"):
            status, _ = self.request(method, "/api/unknown", {})
            self.assertEqual(status, 404)
