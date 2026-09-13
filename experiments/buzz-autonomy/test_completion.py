"""Exercise the worker boundary when Hermes returns a forced partial summary."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import evidence
import pilot
import worker


class CompletionBoundary(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        for module in (pilot, evidence, worker):
            override = patch.object(module, "ROOT", Path(directory.name))
            override.start(); self.addCleanup(override.stop)
        init = patch.object(worker, "initial", return_value="")
        init.start(); self.addCleanup(init.stop)

    def test_partial_summary_is_not_done_and_cannot_release_dependent_work(self):
        pilot.enqueue("product", "bounded work", "parent")
        pilot.enqueue("coder", "depends on complete parent", "child", depends_on=["parent"])
        result = {"final_response": "Plausible but forced report", "completed": False,
                  "turn_exit_reason": "max_iterations_reached(12/12)", "messages": []}
        agent = SimpleNamespace(run_conversation=lambda *a, **k: result)
        with patch.object(worker, "make_agent", return_value=agent), patch.object(worker, "publish", return_value={}):
            with self.assertRaises(RuntimeError):
                worker.run("parent")
            with self.assertRaises(RuntimeError):
                worker.run("child")
        with pilot.database() as db:
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE id='parent'").fetchone()[0], "failed")
            self.assertEqual(db.execute("SELECT attempts FROM jobs WHERE id='child'").fetchone()[0], 0)

    def test_native_partial_parent_cannot_release_delegated_work(self):
        pilot.enqueue("coder", "delegated work", "child", parent="native-parent")
        with pilot.database() as db:
            db.execute("INSERT INTO inbound VALUES('maestro','event','native-parent','failed',0)")
        with self.assertRaises(RuntimeError):
            worker.run("child")


if __name__ == "__main__":
    unittest.main()
