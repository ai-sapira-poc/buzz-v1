"""Deterministic control checks, separate from the required live Hermes cases."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

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

    def test_operator_report_uses_a_human_heading_and_stays_non_delegating(self):
        import reporting

        body, mentions = reporting.resolve_mentions(
            "[informe] Resultado para el equipo — Arquitectura\n\n@coder\n\n"
            "Referencia técnica: opaque-job",
            "opaque-job",
        )
        self.assertEqual(mentions, [])
        self.assertIn("Resultado para el equipo", body)

    def test_maestro_can_read_buzz_without_mutation(self):
        # The maestro needs the read-only product surface to inspect a thread or
        # verify a status when the operator asks "look at this".
        self.assertIn("buzz", capabilities.PERMISSIONS["maestro"])

    def test_delegate_publishes_operator_status_at_creation(self):
        # Bind the assertion to the real capability seam: the operator must see
        # that work was created even if the following model turn is slow or dies.
        from unittest.mock import patch

        with patch("operator_updates.publish_delegation") as publish:
            result = capabilities.operate(
                "maestro", "root", "delegate",
                {"id": "child", "role": "architect", "prompt": "Inspect the repository"},
            )
        self.assertEqual(result, {"job": "child"})
        publish.assert_called_once_with("maestro", "architect", "child",
                                        dependencies=None)

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

    def test_non_object_args_get_the_same_actionable_error_as_missing_args(self):
        # A real run sent {"action": "write", "args": ""} and got back
        # "string indices must be integers" — nothing to act on, one turn lost.
        for args in ("", [], None, 3):
            with self.assertRaises(ValueError) as caught:
                capabilities.check_call({"action": "write", "args": args})
            self.assertIn("args", str(caught.exception))
            self.assertIn(capabilities.CALL_EXAMPLE, str(caught.exception))
        with self.assertRaises(ValueError) as caught:
            capabilities.check_call({"action": "write"})
        self.assertIn("args", str(caught.exception))
        self.assertIn(capabilities.CALL_EXAMPLE, str(caught.exception))

    def test_batch_steps_with_non_object_args_fail_the_same_way(self):
        for args in ("", [], None):
            with self.assertRaises(ValueError) as caught:
                capabilities.operate("reviewer", "batch-shape", "batch",
                                     {"steps": [{"action": "read", "args": args}]})
            self.assertIn("args", str(caught.exception))
            self.assertIn(capabilities.CALL_EXAMPLE, str(caught.exception))

    def test_list_shows_what_exists_and_every_reader_may_use_it(self):
        # 106 of 321 tool errors in pilot.db were FileNotFoundError on read:
        # agents guessed paths because nothing let them look first.
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "artifacts" / "tower" / "deep").mkdir(parents=True)
            (root / "artifacts" / "tower" / "plan.md").write_text("hola")
            (root / "artifacts" / "tower" / "deep" / "x.md").write_text("x")
            with patch.object(pilot, "ROOT", root), patch.object(capabilities, "ROOT", root):
                shallow = capabilities.list_entries("tower", 1, 50)
                deep = capabilities.list_entries(".", 3, 50)
                capped = capabilities.list_entries(".", 3, 1)
        self.assertEqual([e["path"] for e in shallow["entries"]], ["tower/deep", "tower/plan.md"])
        self.assertIn("tower/deep/x.md", [e["path"] for e in deep["entries"]])
        self.assertTrue(capped["truncated"])
        for role, grants in capabilities.PERMISSIONS.items():
            if "read" in grants:
                self.assertIn("list", grants, role)

    def test_a_missing_path_names_its_neighbours_instead_of_errno_2(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "artifacts" / "tower").mkdir(parents=True)
            (root / "artifacts" / "tower" / "plan-arranque.md").write_text("p")
            (root / "artifacts" / "tower" / "encargo.md").write_text("e")
            with patch.object(pilot, "ROOT", root), patch.object(capabilities, "ROOT", root):
                with self.assertRaises(FileNotFoundError) as caught:
                    capabilities.operate("coder", "job", "read", {"path": "tower/plan-arranqe.md"})
        message = str(caught.exception)
        self.assertIn("plan-arranque.md", message)
        self.assertIn("list", message)
        self.assertNotIn("Errno", message)

    def test_missing_required_keys_are_named_instead_of_a_bare_key_error(self):
        (pilot.ROOT / "artifacts").mkdir()
        cases = [
            ("reviewer", "read", {}, "path"),
            ("designer", "write", {"content": "x"}, "path"),
            ("designer", "write", {"path": "x.html"}, "content"),
        ]
        for role, action, args, key in cases:
            with self.assertRaises(ValueError) as caught:
                capabilities.operate(role, "keys", action, args)
            self.assertIn(key, str(caught.exception))
            self.assertIn(capabilities.CALL_EXAMPLE, str(caught.exception))

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


class TheWorkIsReadableByAProgramToo(unittest.TestCase):
    """Kinds 43001-43006 existed, the desktop feed already rendered all six,
    and nothing ever emitted them. Tower Control and the feed both sat in
    front of an empty stream while the control plane's work stayed locked
    inside its own sqlite.
    """

    def test_every_operator_state_maps_to_a_lifecycle_kind(self):
        import operator_updates

        # The states the runtime actually publishes, from worker.py and
        # supervisor.py. A state with no mapping would go out as prose only.
        for state in ("created", "started", "running", "done", "cancelled", "failed"):
            self.assertIn(state, operator_updates.JOB_EVENT_STATE, state)

    def test_an_unknown_state_is_skipped_rather_than_guessed(self):
        import operator_updates

        self.assertFalse(
            operator_updates.publish_job_event("maestro", "designer", "j", "vibes"))

    def test_the_relay_being_down_never_fails_the_work(self):
        # A job that succeeded must not be recorded as failed because a
        # publication did not land. The local event is the retry record.
        from unittest.mock import patch
        import operator_updates

        recorded = []
        with patch.object(operator_updates, "event",
                          lambda *a, **k: recorded.append(a[2])), \
             patch("pilot.buzz", side_effect=RuntimeError("relay down")):
            published = operator_updates.publish_job_event(
                "maestro", "designer", "job-1", "done")
        self.assertFalse(published)
        self.assertIn("job_event_failed", recorded)

    def test_the_line_reads_as_business_language_not_as_a_state_name(self):
        import operator_updates

        line = operator_updates._line("designer", "failed", "max_iterations_reached(32/32)")
        self.assertIn("no ha podido entregar", line)
        self.assertNotIn("failed", line)
        self.assertLessEqual(len(line), 400)


class TheHandoffEdgeReachesTheSurface(unittest.TestCase):
    """The handoff was recorded (`handoff_published`) but reached no surface:
    nothing published it. Kind 43007 exists and the desktop draws the edge, so
    without a producer the surface would say "no hay relevos" for a fact the
    system did record.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(pilot, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        pilot.enqueue("product", "brief", "parent-job")
        pilot.enqueue("coder", "brief", "child-a", parent="parent-job")
        pilot.enqueue("designer", "brief", "child-b", parent="parent-job")

    def _capture(self):
        calls = []

        def buzz(role, args):
            calls.append(list(args))
            return {"event_id": f"edge-{len(calls)}"}

        return calls, buzz

    def test_one_event_per_child_never_one_per_parent(self):
        import operator_updates

        calls, buzz = self._capture()
        with patch("pilot.config", return_value={"viewer": "a" * 64}), \
                patch("pilot.buzz", side_effect=buzz):
            published = operator_updates.publish_handoffs(
                "product", "product", "parent-job")

        self.assertEqual(published, ["child-a", "child-b"])
        self.assertEqual(len(calls), 2, "fan-out is one edge per child")
        for args, child in zip(calls, ["child-a", "child-b"]):
            self.assertEqual(args[args.index("--job") + 1], "parent-job")
            self.assertEqual(args[args.index("--child") + 1], child)
            self.assertEqual(args[args.index("--state") + 1], "handoff")

    def test_a_relay_failure_is_recorded_not_rendered_as_absence(self):
        # The work is already delivered; a publication that did not land must
        # leave a row that says so, never a silent gap the surface reads as
        # "no handoff".
        import operator_updates

        recorded = []
        with patch.object(operator_updates, "event",
                          lambda *a, **k: recorded.append((a[2], k.get("data", a[3])))), \
                patch("pilot.config", return_value={"viewer": "a" * 64}), \
                patch("pilot.buzz", side_effect=RuntimeError("relay down")):
            published = operator_updates.publish_handoffs(
                "product", "product", "parent-job")

        self.assertEqual(published, [])
        actions = [action for action, _ in recorded]
        self.assertIn("job_handoff_failed", actions)
        self.assertEqual(actions.count("job_handoff_failed"), 2)

    def test_a_job_with_no_children_publishes_nothing(self):
        import operator_updates

        calls, buzz = self._capture()
        with patch("pilot.config", return_value={"viewer": "a" * 64}), \
                patch("pilot.buzz", side_effect=buzz):
            published = operator_updates.publish_handoffs(
                "product", "product", "child-a")

        self.assertEqual(published, [])
        self.assertEqual(calls, [])

    def test_the_line_names_the_child_and_stays_business_language(self):
        import operator_updates

        line = operator_updates._handoff_line("product", "child-a", None)
        self.assertIn("child-a", line)
        self.assertLessEqual(len(line), 400)


class TheWaitReachesTheSurface(unittest.TestCase):
    """`pursuit_exhausted` records that the ladder gave up, but nothing
    projected it onto the relay, so the panel's waiting cell had no producer.
    Kind 43008 is that projection, and its reason is the obstacle the ladder
    already classified — never a guess about a cause the code cannot see.
    """

    def test_the_reason_comes_from_the_closed_vocabulary(self):
        import operator_updates

        self.assertEqual(
            operator_updates.waiting_reason("denied"), "capability_denied")
        for obstacle in ("blocked", "transient", "budget", "timeout", "empty",
                         "unknown"):
            self.assertEqual(
                operator_updates.waiting_reason(obstacle), "ladder_exhausted",
                obstacle)

    def test_the_event_names_its_reason_and_stays_business_language(self):
        import operator_updates

        calls = []

        def buzz(role, args):
            calls.append(list(args))
            return {"event_id": "w-1"}

        with patch("pilot.config", return_value={"viewer": "a" * 64}), \
                patch("pilot.buzz", side_effect=buzz):
            published = operator_updates.publish_waiting(
                "coder", "coder", "job-1", "ladder_exhausted", "budget")

        self.assertTrue(published)
        args = calls[0]
        self.assertEqual(args[args.index("--state") + 1], "waiting")
        self.assertEqual(args[args.index("--reason") + 1], "ladder_exhausted")
        line = args[args.index("--content") + 1]
        self.assertIn("siguiente movimiento es del operador", line)
        self.assertNotIn("ladder_exhausted", line)
        self.assertLessEqual(len(line), 400)

    def test_a_relay_failure_is_recorded_not_raised(self):
        # A relay that is down must not turn a stopped ladder into a different
        # outcome: the local row stays the retry record, and the failed
        # projection leaves a row that says so.
        import operator_updates

        recorded = []
        with patch.object(operator_updates, "event",
                          lambda *a, **k: recorded.append(a[2])), \
                patch("pilot.config", return_value={"viewer": "a" * 64}), \
                patch("pilot.buzz", side_effect=RuntimeError("relay down")):
            published = operator_updates.publish_waiting(
                "coder", "coder", "job-1", "ladder_exhausted", "budget")

        self.assertFalse(published)
        self.assertIn("waiting_failed", recorded)
