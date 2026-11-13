"""Host admission and HTTP security run even without numerical dependencies."""
import json
import sys
import threading
import time
import unittest
import uuid
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import CanvasServer
from optimizer_transport import OptimizerHost, OptimizerBusy
from artifact_optimizer import BackendUnavailable


class HostTests(unittest.TestCase):
    def test_admission_cancel_and_close_hold_until_settled(self):
        host = OptimizerHost()
        tokens = [str(uuid.uuid4()) for _ in range(3)]
        entered = [threading.Event(), threading.Event()]
        released = threading.Event()
        results = []

        def solve(_body, *, cancelled):
            index = tokens.index(threading.current_thread().name)
            entered[index].set()
            while not cancelled():
                time.sleep(.001)
            # Cancellation alone must not release admission until reap has finished.
            released.wait(3)
            return {"code": "cancelled"}

        def run(token):
            results.append(host.optimize(token, {}))

        with patch("optimizer_transport.validate"), patch("optimizer_transport.solve", side_effect=solve):
            workers = [threading.Thread(target=run, args=(token,), name=token) for token in tokens[:2]]
            for worker in workers:
                worker.start()
            try:
                for event in entered:
                    self.assertTrue(event.wait(3))
                with self.assertRaises(OptimizerBusy):
                    host.optimize(tokens[2], {})
                with self.assertRaises(OptimizerBusy):
                    host.capability()
                host.cancel(tokens[0])
                with self.assertRaises(OptimizerBusy):
                    host.optimize(tokens[2], {})
                closing = threading.Thread(target=host.close)
                closing.start()
                self.assertTrue(closing.is_alive())
            finally:
                released.set()
                for worker in workers:
                    worker.join(3)
                closing.join(3)
            self.assertFalse(closing.is_alive())
            self.assertEqual(len(results), 2)
            self.assertEqual(host.jobs, {})

    def test_incompatible_capability_is_unavailable(self):
        host = OptimizerHost()
        identity = {"adapter": "manifold-numeric-optimizer/1", "source_sha256": "0" * 64,
                    "python": "3.13.1", "numpy": "2.2.6", "scipy": "1.15.3"}
        with patch("optimizer_transport.backend_identity", return_value=identity):
            with self.assertRaises(BackendUnavailable):
                host.capability()
        host.close()

    def test_precancel_tombstones_bounded_and_expire(self):
        host = OptimizerHost()
        token = str(uuid.uuid4())
        host.cancel(token)
        with patch("optimizer_transport.validate"), patch("optimizer_transport.solve", side_effect=lambda _, cancelled: {"cancelled": cancelled()}):
            self.assertEqual(host.optimize(token, {}), {"cancelled": True})
        with patch("optimizer_transport.time.monotonic", return_value=time.monotonic() + 40):
            with host.lock:
                host.prune()
        self.assertEqual(host.jobs, {})
        for _ in range(128):
            host.cancel(str(uuid.uuid4()))
        with self.assertRaises(OptimizerBusy):
            host.cancel(str(uuid.uuid4()))
        with self.assertRaises(ValueError):
            host.cancel("arbitrary/path")
        host.close()


class RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = CanvasServer(("127.0.0.1", 0))
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, body=None, **headers):
        connection = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request("GET" if body is None else "POST", "/api/optimizer/" + path,
                               None if body is None else json.dumps(body), {"Content-Type": "application/json", **headers})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_all_routes_validate_origin_and_host(self):
        for action, body in [("capability", None), ("cancel", {"token": str(uuid.uuid4())}), ("optimize", {})]:
            self.assertEqual(self.request(action, body, Origin="https://evil.example")[0], 403)
            self.assertEqual(self.request(action, body, Host="evil.example")[0], 403)
        self.assertEqual(self.request("cancel", {"token": str(uuid.uuid4())}, Origin="http://127.0.0.1:58311")[0], 200)

    def test_raw_body_cap_and_exact_wrapper(self):
        self.assertEqual(self.request("optimize", {"padding": "x" * 66001})[0], 400)
        self.assertEqual(self.request("cancel", {"token": "x" * 129})[0], 400)
        self.assertEqual(self.request("cancel", {"token": str(uuid.uuid4()), "extra": 1})[0], 400)
        self.assertEqual(self.request("optimize", {"token": str(uuid.uuid4()), "request": {}})[0], 400)

    def test_unavailable_and_busy_are_explicit(self):
        with patch.object(self.server.optimizer, "capability", side_effect=BackendUnavailable("Numerical environment unavailable")):
            self.assertEqual(self.request("capability")[0], 503)
        with patch.object(self.server.optimizer, "capability", side_effect=OptimizerBusy("busy")):
            self.assertEqual(self.request("capability")[0], 429)
        with patch.object(self.server.optimizer, "optimize", side_effect=OptimizerBusy("busy")):
            self.assertEqual(self.request("optimize", {"token": str(uuid.uuid4()), "request": {}})[0], 429)


if __name__ == "__main__":
    unittest.main()
