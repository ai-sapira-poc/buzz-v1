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


class ServedChannel(unittest.TestCase):
    """The channel the harness listens on is the one a request is scoped to.

    This is a measured defect, not a hypothetical: the fleet ran on a project
    channel while `config()["channel"]` still named the community default, so
    every live mention was looked up in the wrong channel, the relay answered
    "does not belong to channel …", and the turn ended in two seconds with
    nothing published. The agents looked mute.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = patch.object(pilot, "ROOT", Path(self.temp.name))
        root.start(); self.addCleanup(root.stop)
        self.c = {"channel": "default-channel", "relay": "https://example.invalid",
                  "viewer": "owner",
                  "identities": {"maestro": {"pubkey": "master"}, "editor": {"pubkey": "editor"}}}
        cfg = patch.object(inbound, "config", return_value=self.c)
        cfg.start(); self.addCleanup(cfg.stop)
        self.row = {"id": "b" * 64, "pubkey": "owner",
                    "tags": [["h", "project-channel"], ["p", "master"]],
                    "content": "Do the bounded task"}
        # Behave like the relay does: an event is only retrievable through the
        # channel it belongs to. A mock that ignores the channel argument would
        # pass with the bug still in place.
        def relay(role, args):
            asked = args[args.index("--channel") + 1]
            if asked != "project-channel":
                raise RuntimeError("event does not belong to channel " + asked)
            return [self.row]
        fetch = patch.object(inbound, "buzz", side_effect=relay)
        fetch.start(); self.addCleanup(fetch.stop)

    def test_a_mention_in_the_served_channel_is_claimed(self):
        with patch.dict("os.environ", {"BUZZ_ACP_CHANNELS": "project-channel"}):
            claimed = inbound.claim("maestro", "Event ID: " + self.row["id"])
        self.assertIsNotNone(claimed, "una mención en el canal servido debe reclamarse")
        self.assertIn(self.row["content"], claimed[1])

    def test_the_default_channel_is_used_only_when_none_is_served(self):
        with patch.dict("os.environ", {"BUZZ_ACP_CHANNELS": ""}):
            with self.assertRaises(PermissionError):
                inbound.claim("maestro", "Event ID: " + self.row["id"])

    def test_the_membership_tag_is_checked_against_the_channel_it_was_found_in(self):
        # Finding the event must not become a licence to skip the `h` check —
        # that check is what keeps a request scoped to a channel we serve.
        self.row["tags"][0] = ["h", "somewhere-else"]
        with patch.dict("os.environ", {"BUZZ_ACP_CHANNELS": "project-channel"}):
            with self.assertRaises(PermissionError):
                inbound.claim("maestro", "Event ID: " + self.row["id"])


class ReplyChannel(unittest.TestCase):
    def test_a_live_agent_publishes_where_it_listens(self):
        # The way in and the way out must name the same channel, or the answer
        # lands where nobody asked.
        source = (Path(__file__).parent / "control_plane/run_hermes.py").read_text()
        self.assertIn('"BUZZ_PUBLISH_CHANNEL": channel', source)
        self.assertIn('"BUZZ_ACP_CHANNELS": channel', source)


if __name__ == "__main__":
    unittest.main()
