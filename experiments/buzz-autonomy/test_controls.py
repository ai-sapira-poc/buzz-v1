"""Deterministic control checks, separate from the required live Hermes cases."""
import tempfile
from pathlib import Path
import unittest

import pilot
import capabilities
import supervisor
from reporting import report_text


class Controls(unittest.TestCase):
    def test_npub_addressing_is_still_neutralised(self):
        # Teammate mentions are now allowed — that is how the maestro
        # orchestrates. `nostr:` prefixes are not: they address arbitrary keys,
        # so resolving them would let fetched text page anyone in the world.
        text = report_text("@maestro nostr:npub1example NOSTR:nprofile1example")
        self.assertIn("@maestro", text)
        self.assertNotIn("nostr:", text.lower())
        self.assertEqual(report_text(text), text)

    def test_a_report_never_carries_mentions(self):
        # The `[job-id]` envelope marks a result. A result that could page a
        # teammate would turn every answer into a new assignment, which is the
        # loop the old blanket ban existed to prevent.
        import reporting

        body, mentions = reporting.resolve_mentions("[job-7] listo, @coder", "job-7")
        self.assertEqual(mentions, [])
        self.assertIn("@coder", body)

    def test_unknown_names_stay_literal(self):
        import reporting

        body, mentions = reporting.resolve_mentions("@nadie-de-este-equipo hola", "j")
        self.assertEqual(mentions, [])
        self.assertIn("@nadie-de-este-equipo", body)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = (pilot.ROOT, capabilities.ROOT, supervisor.ROOT)
        pilot.ROOT = capabilities.ROOT = supervisor.ROOT = Path(self.directory.name)

    def tearDown(self):
        pilot.ROOT, capabilities.ROOT, supervisor.ROOT = self.previous
        self.directory.cleanup()

    def test_duplicate_and_conflicting_job(self):
        pilot.enqueue("product", "same", "one")
        pilot.enqueue("product", "same", "one")
        with pilot.database() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM jobs").fetchone()[0], 1)
        with self.assertRaises(ValueError):
            pilot.enqueue("product", "different", "one")

    def test_dependencies_are_stable_and_cannot_point_forward(self):
        with self.assertRaises(ValueError):
            pilot.enqueue("coder", "build", "code", depends_on=["design"])
        pilot.enqueue("designer", "design", "design")
        pilot.enqueue("coder", "build", "code", depends_on=["design"])
        with self.assertRaises(ValueError):
            pilot.enqueue("coder", "build", "code", depends_on=[])
        with self.assertRaises(ValueError):
            pilot.enqueue("coder", "build", "loop", depends_on=["loop"])

    def test_budget_and_no_recursive_supervisor(self):
        for i in range(14):
            pilot.enqueue("research", "bounded", f"child-{i}", parent="root")
        with self.assertRaises(PermissionError):
            pilot.enqueue("research", "excess", "child-15", parent="root")
        with self.assertRaises(PermissionError):
            capabilities.operate("maestro", "root", "delegate", {"role": "maestro", "prompt": "loop", "id": "recursive"})

    def test_railway_mutation_and_unscoped_read_are_denied(self):
        for action in ("deploy", "delete", "restart", "terminal"):
            with self.assertRaises(PermissionError):
                capabilities.operate("operations", "negative", action, {})
        for value in ("../config.json", "/etc/passwd"):
            with self.assertRaises(PermissionError):
                capabilities.operate("operations", "negative", "read", {"path": value})
        with self.assertRaises(ValueError):
            pilot.enqueue("product", "escape", "../../escape")

    def test_symlink_escape_is_denied(self):
        artifacts = pilot.ROOT / "artifacts"; artifacts.mkdir()
        (artifacts / "escape").symlink_to(pilot.ROOT, target_is_directory=True)
        with self.assertRaises(PermissionError):
            pilot.safe_path("escape/config.json")

    def test_large_read_reports_and_recovers_omitted_tail(self):
        artifacts = pilot.ROOT / "artifacts"; artifacts.mkdir()
        content = "x" * 24000 + "critical validation logic"
        (artifacts / "app.html").write_text(content)
        first = capabilities.operate("reviewer", "read-test", "read", {"path": "app.html"})
        self.assertTrue(first["truncated"])
        second = capabilities.operate("reviewer", "read-test", "read", {"path": "app.html", "offset": first["next_offset"]})
        self.assertFalse(second["truncated"])
        self.assertEqual(first["content"] + second["content"], content)

    def test_pause_cancel_and_bounded_retry(self):
        pilot.enqueue("product", "task", "task")
        (pilot.ROOT / "PAUSED").touch()
        self.assertEqual(supervisor.tick(2), [])
        self.assertTrue(supervisor.cancel("task"))
        self.assertFalse(supervisor.retry("task"))
        with pilot.database() as db:
            db.execute("UPDATE jobs SET status='failed',attempts=3 WHERE id='task'")
        self.assertFalse(supervisor.retry("task"))
        with self.assertRaises(ValueError):
            supervisor.tick(21)

    def test_skill_rollback_keeps_rejected_version_and_requires_scope(self):
        import json
        base = {"id": "candidate", "kind": "skill", "text": "baseline procedure", "evidence": ["observation-1"]}
        capabilities.operate("maestro", "learn", "remember", base)
        capabilities.operate("maestro", "learn", "remember", {**base, "text": "defective procedure", "status": "rejected"})
        restore = {"id": "candidate", "kind": "skill", "restore_revision": 1, "evidence": ["failed transfer"]}
        with self.assertRaises(PermissionError):
            capabilities.operate("product", "learn", "remember", restore)
        capabilities.operate("reviewer", "learn", "remember", restore)
        entry = capabilities.operate("maestro", "learn", "recall", {"id": "candidate", "history": True})[0]
        self.assertEqual(entry["revision"], 3)
        self.assertEqual(json.loads(entry["body"])["text"], "baseline procedure")
        self.assertEqual(json.loads(entry["history"][1]["body"])["text"], "defective procedure")
        with self.assertRaises(PermissionError):
            capabilities.operate("maestro", "learn", "remember", {**base, "status": "supported"})


if __name__ == "__main__":
    unittest.main()
