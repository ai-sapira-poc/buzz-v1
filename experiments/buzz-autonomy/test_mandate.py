"""Boundary tests for native mandate isolation, dependency gating and replay."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pilot
import mandate
import supervisor
import capabilities


class MandateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        for module in (pilot, mandate, supervisor, capabilities):
            override = patch.object(module, "ROOT", Path(directory.name))
            override.start()
            self.addCleanup(override.stop)
        with pilot.database() as db:
            db.execute("INSERT INTO inbound VALUES('maestro','event','native-test','done',0)")

    def complete(self, job):
        with pilot.database() as db:
            db.execute("UPDATE jobs SET status='done',attempts=attempts+1 WHERE id=?", (job,))
        return True

    def test_scoped_dependency_order_and_single_synthesis_on_replay(self):
        pilot.enqueue("coder", "other", "unrelated")
        pilot.enqueue("coder", "create", "build", parent="native-test")
        pilot.enqueue("reviewer", "review", "review", parent="native-test", depends_on=["build"])
        calls = []
        def complete(job):
            calls.append(job)
            return self.complete(job)
        with patch.object(supervisor, "execute", side_effect=complete), patch.object(mandate, "execute", side_effect=complete):
            self.assertEqual(mandate.drive("native-test")["status"], "done")
            self.assertEqual(mandate.drive("native-test")["status"], "done")
        self.assertEqual(calls, ["build", "review", mandate.synthesis_id("native-test")])
        with pilot.database() as db:
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE id='unrelated'").fetchone()[0], "queued")

    def test_failed_child_blocks_review_and_synthesis(self):
        pilot.enqueue("coder", "create", "build", parent="native-test")
        pilot.enqueue("reviewer", "review", "review", parent="native-test", depends_on=["build"])
        def fail(job):
            with pilot.database() as db:
                db.execute("UPDATE jobs SET status='failed' WHERE id=?", (job,))
        with patch.object(supervisor, "execute", side_effect=fail), patch.object(mandate, "execute") as synthesis:
            self.assertEqual(mandate.drive("native-test")["status"], "incomplete")
            synthesis.assert_not_called()
        with pilot.database() as db:
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE id='review'").fetchone()[0], "queued")

    def test_synthesis_cannot_reopen_delegation(self):
        with self.assertRaises(PermissionError):
            capabilities.operate("maestro", mandate.synthesis_id("native-test"), "delegate",
                                 {"id": "unexpected", "role": "coder", "prompt": "more work"})

    def test_pause_and_unknown_native_parent_do_not_execute(self):
        pilot.enqueue("coder", "create", "build", parent="native-test")
        (pilot.ROOT / "PAUSED").touch()
        with patch.object(supervisor, "execute") as execute:
            self.assertEqual(mandate.drive("native-test")["status"], "paused")
            with self.assertRaises(ValueError):
                mandate.drive("unknown")
            execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
