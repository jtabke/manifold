"""Exercise lazy companion startup/cleanup without a provider inference request."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant_bridge import AssistantBridge, AssistantUnavailable


class AssistantBridgeTests(unittest.TestCase):
    def test_owned_process_configuration_key_isolation_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"PI_CODING_AGENT_DIR": directory}):
                bridge = AssistantBridge(58310)
                self.assertIsNone(bridge.process, "ordinary canvas startup launches no agent")
                process = None
                try:
                    status, config = bridge.request("configuration")
                    self.assertEqual(status, 200)
                    self.assertTrue(config["providers"])
                    self.assertNotIn("apiKey", config)
                    process = bridge.process
                    self.assertIsNone(process.poll())
                    status, result = bridge.request("connect", {
                        "provider": "openai", "model": "gpt-6.1-sol",
                        "apiKey": "manifold-test-key-not-a-real-credential",
                    })
                    self.assertEqual(status, 200)
                    self.assertIn("ticket=", result["url"])
                    self.assertNotIn("manifold-test-key", result["url"])
                    self.assertIs(bridge.process, process, "one companion per local server")
                    auth = Path(directory, "auth.json")
                    if auth.exists():
                        self.assertNotIn("manifold-test-key", auth.read_text())
                finally:
                    bridge.close()
                self.assertIsNotNone(process.poll())
                self.assertIsNone(bridge.process)
                with self.assertRaises(AssistantUnavailable):
                    bridge.request("configuration")

    def test_start_failure_can_be_retried_without_leaking_a_process(self):
        bridge = AssistantBridge(58310)
        try:
            with patch("assistant_bridge.subprocess.Popen", side_effect=OSError("private local path")):
                with self.assertRaises(AssistantUnavailable) as caught:
                    bridge.request("configuration")
                self.assertNotIn("private local path", str(caught.exception))
                self.assertIsNone(bridge.process)
        finally:
            bridge.close()
