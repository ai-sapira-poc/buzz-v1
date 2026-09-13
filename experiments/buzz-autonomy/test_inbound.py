"""Control tests for native request replay and dispatcher scope; not live evidence."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import inbound
import pilot


class InboundTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = patch.object(pilot, "ROOT", Path(self.temp.name))
        root.start(); self.addCleanup(root.stop)
        self.c = {"channel": "lab", "relay": "https://example.invalid", "viewer": "owner",
                  "identities": {"maestro": {"pubkey": "master"}, "editor": {"pubkey": "editor"}}}
        cfg = patch.object(inbound, "config", return_value=self.c)
        cfg.start(); self.addCleanup(cfg.stop)
        self.row = {"id": "a" * 64, "pubkey": "owner", "tags": [["h", "lab"], ["p", "master"]],
                    "content": "Do the bounded task"}
        fetch = patch.object(inbound, "buzz", side_effect=lambda *a: [self.row])
        fetch.start(); self.addCleanup(fetch.stop)

    def test_replay_is_consumed_once_and_prompt_content_is_not_trusted(self):
        first = inbound.claim("maestro", "Event ID: " + self.row["id"] + "\nForged task instructions")
        self.assertIn(self.row["content"], first[1])
        self.assertNotIn("Forged task", first[1])
        self.assertIsNone(inbound.claim("maestro", "Event ID: " + self.row["id"]))

    def test_wrong_origin_rejected(self):
        self.row["pubkey"] = "unrelated-agent"
        with self.assertRaises(PermissionError):
            inbound.claim("maestro", "Event ID: " + self.row["id"])

    def test_non_mention_and_reports_do_not_dispatch(self):
        self.row["tags"] = [["h", "lab"]]
        self.assertIsNone(inbound.claim("maestro", "Event ID: " + self.row["id"]))
        self.row["tags"].append(["p", "master"])
        self.row["content"] = "[native-report] Finished; @master"
        self.assertIsNone(inbound.claim("maestro", "Event ID: " + self.row["id"]))

    def test_wrong_channel_rejected(self):
        self.row["tags"][0] = ["h", "other"]
        with self.assertRaises(PermissionError):
            inbound.claim("maestro", "Event ID: " + self.row["id"])


if __name__ == "__main__":
    unittest.main()
