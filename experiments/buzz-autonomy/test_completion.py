"""Exercise the worker boundary when Hermes returns a forced partial summary."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import design_guard
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

    def test_a_hermes_handoff_reaches_the_wire_for_each_child(self):
        """The delegating role is Hermes, so the Pi emit points never fire.

        Measured against the pilot database, every job that has children is a
        `maestro` job on the Hermes harness — two thirds of the parents are
        `tower-maestro-*` and the rest are scheduled `maestro-*` ids. A producer
        wired only into `dispatch_pi` / `_execute_pi` therefore projects
        nothing at all, and the surface reports a fact the system recorded as
        "no hay relevos". The edge has to be emitted here, where the Hermes
        handoff is itself recorded.
        """
        import operator_updates

        pilot.enqueue("maestro", "hand-off", "parent")
        pilot.enqueue("coder", "brief", "child-a", parent="parent")
        pilot.enqueue("designer", "brief", "child-b", parent="parent")
        result = {"final_response": "handoff text", "completed": True}
        agent = SimpleNamespace(run_conversation=lambda *a, **k: result)
        projected = []
        with patch.object(worker, "make_agent", return_value=agent), \
                patch.object(worker, "publish", return_value={}), \
                patch.object(operator_updates, "publish_handoffs",
                             side_effect=lambda *a, **k: projected.append(a)):
            worker.run("parent")

        self.assertEqual(len(projected), 1, "one projection per completed job")
        args = projected[0]
        # (publisher, role, job) — the edge is emitted for the job that finished,
        # which is the one holding the children.
        self.assertEqual(args[2], "parent")

    def _record_receipt(self, job, relative, text):
        target = pilot.ROOT / "artifacts" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        design_guard.record(job, {"path": relative, "sha256": design_guard.digest(text),
                                  "kind": "html-foundation", "sources": {}, "professional_acceptance": False})
        return target

    def _run_incomplete(self, job):
        result = {"final_response": "Budget ran out", "completed": False,
                  "turn_exit_reason": "max_iterations_reached(16/16)", "messages": []}
        agent = SimpleNamespace(run_conversation=lambda *a, **k: result)
        published = []
        with patch.object(worker, "make_agent", return_value=agent), \
                patch.object(worker, "publish", side_effect=lambda r, j, t: published.append(t) or {}):
            with self.assertRaises(RuntimeError) as raised:
                worker.run(job)
        with pilot.database() as db:
            row = db.execute("SELECT status, result FROM jobs WHERE id=?", (job,)).fetchone()
            events = [e[0] for e in db.execute("SELECT action FROM events WHERE job=?", (job,)).fetchall()]
        return published[0], str(raised.exception), row, events

    def test_incomplete_run_surfaces_gate_validated_artifacts_without_accepting_them(self):
        pilot.enqueue("designer", "design a screen", "slice")
        self._record_receipt("slice", "design/tower-slice1-screen.html", "<html>validated</html>")
        sha = design_guard.digest("<html>validated</html>")[:12]
        text, error, row, events = self._run_incomplete("slice")
        self.assertEqual(row["status"], "failed")
        self.assertIn("Artefactos validados por el gate (no aceptados):", text)
        self.assertIn("design/tower-slice1-screen.html sha256 " + sha, text)
        self.assertTrue(text.startswith("EJECUCIÓN INCOMPLETA"))
        self.assertIn("validated-by-gate, not accepted: design/tower-slice1-screen.html (" + sha, error)
        self.assertIn("design/tower-slice1-screen.html", row["result"])
        self.assertIn("validated_artifacts_on_incomplete", events)

    def test_receipt_whose_file_changed_is_not_listed(self):
        pilot.enqueue("designer", "design a screen", "stale")
        target = self._record_receipt("stale", "design/screen.html", "<html>validated</html>")
        target.write_text("<html>edited after the gate</html>")
        self.assertEqual(design_guard.validated_artifacts("stale"), [])
        text, error, row, events = self._run_incomplete("stale")
        self.assertEqual(row["status"], "failed")
        self.assertNotIn("Artefactos validados", text)
        self.assertNotIn("validated-by-gate", error)
        self.assertNotIn("validated_artifacts_on_incomplete", events)

    def test_validated_artifacts_keeps_only_matching_receipts(self):
        self._record_receipt("mixed", "design/a.html", "<html>a</html>")
        gone = self._record_receipt("mixed", "design/b.html", "<html>b</html>")
        gone.unlink()
        artifacts = design_guard.validated_artifacts("mixed")
        self.assertEqual([a["path"] for a in artifacts], ["design/a.html"])
        self.assertEqual(artifacts[0]["kind"], "html-foundation")
        self.assertEqual(design_guard.validated_artifacts("no-such-job"), [])

    def test_native_partial_parent_cannot_release_delegated_work(self):
        pilot.enqueue("coder", "delegated work", "child", parent="native-parent")
        with pilot.database() as db:
            db.execute("INSERT INTO inbound VALUES('maestro','event','native-parent','failed',0)")
        with self.assertRaises(RuntimeError):
            worker.run("child")


if __name__ == "__main__":
    unittest.main()
