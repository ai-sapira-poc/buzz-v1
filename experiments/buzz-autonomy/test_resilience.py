"""Guard the properties that let a project survive its own failures.

Each test here is bound to a failure that actually happened in the Tower Control
launch, not to a hypothetical one. If a guard is removed, the corresponding real
failure comes back silently — which is what made these expensive the first time.
"""
import json
import tempfile
import unittest
from pathlib import Path

import capabilities
import pilot
from control_plane import pursue


class Classification(unittest.TestCase):
    """Name the obstacle from evidence. Two failures are not one failure."""

    def test_budget_exhaustion_is_recognised(self):
        # `tower-diseno` really died with this string.
        self.assertEqual(
            pursue.classify({"reason": "max_iterations_reached(16/16)"}), "budget"
        )

    def test_timeout_is_recognised(self):
        # `tower-arquitecto` really died with TimeoutExpired on pi.
        self.assertEqual(pursue.classify({"reason": "TimeoutExpired"}), "timeout")

    def test_a_repeatedly_blocked_call_outranks_the_budget_it_burned(self):
        # The design gate refused the same write over and over, and the budget
        # died as a *consequence*. Answering "budget" would hand the agent more
        # iterations to spend on the same locked door.
        obstacle = pursue.classify(
            {"reason": "max_iterations_reached(16/16)", "blocked_calls": 4}
        )
        self.assertEqual(obstacle, "blocked")

    def test_a_denied_capability_outranks_everything(self):
        self.assertEqual(
            pursue.classify({"denied": True, "blocked_calls": 9,
                             "reason": "max_iterations_reached(16/16)"}),
            "denied",
        )

    def test_done_with_no_answer_is_not_success(self):
        self.assertEqual(pursue.classify({"status": "done", "final": ""}), "empty")


class Ladder(unittest.TestCase):
    def test_a_permission_failure_has_no_next_rung(self):
        # Retrying a refusal with a bigger budget spends more money on the same
        # refusal. The only correct move is to stop and escalate.
        self.assertEqual(pursue.approach("diseno", "denied", 2, "brief"), {})

    def test_every_other_obstacle_changes_the_brief(self):
        # A retry that sends the identical brief reproduces the identical
        # failure. The whole point of the ladder is that the approach differs.
        for obstacle in ("budget", "timeout", "blocked", "empty", "unknown"):
            with self.subTest(obstacle=obstacle):
                plan = pursue.approach("diseno", obstacle, 2, "brief original")
                self.assertNotEqual(plan["brief"], "brief original")
                self.assertIn("brief original", plan["brief"])

    def test_a_blocked_path_is_never_answered_by_retrying_it(self):
        plan = pursue.approach("diseno", "blocked", 2, "brief")
        self.assertIn("No", plan["brief"])
        self.assertIn("otro camino", plan["brief"])

    def test_budget_exhaustion_buys_a_smaller_scope_not_just_more_budget(self):
        # More iterations on the same plan is the failure, restated. The rung
        # must shrink the work, and the budget increase is secondary.
        plan = pursue.approach("diseno", "budget", 2, "brief")
        self.assertIn("primera pieza indivisible", plan["brief"])
        self.assertGreater(plan["budget"], 16)


class RepeatedFailureBreaker(unittest.TestCase):
    """A stuck loop must become legible before the budget dies."""

    def setUp(self):
        capabilities._REPEATS.clear()

    def test_the_same_failure_is_counted_and_a_different_one_is_not(self):
        for expected in (1, 2, 3):
            self.assertEqual(
                capabilities.repetition("job", "write", "PermissionError:locked"),
                expected,
            )
        self.assertEqual(
            capabilities.repetition("job", "write", "PermissionError:otra cosa"), 1
        )

    def test_the_counter_is_bounded(self):
        for index in range(2100):
            capabilities.repetition(f"job-{index}", "write", "x")
        self.assertLessEqual(len(capabilities._REPEATS), 2000)

    def test_the_thresholds_nudge_before_they_refuse(self):
        self.assertLess(capabilities.NUDGE_AFTER, capabilities.REFUSE_AFTER)
        self.assertLess(capabilities.REFUSE_AFTER, 16,
                        "debe cerrarse antes de agotar el presupuesto de turno")


class ActionableErrors(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = (pilot.ROOT, capabilities.ROOT)
        pilot.ROOT = capabilities.ROOT = Path(self.directory.name)
        (pilot.ROOT / "artifacts").mkdir()

    def tearDown(self):
        pilot.ROOT, capabilities.ROOT = self.previous
        self.directory.cleanup()

    def test_a_half_written_replacement_says_what_is_missing(self):
        # This reached the designer as the bare word "KeyError", so it retried
        # the same malformed call until its budget ran out.
        with self.assertRaises(ValueError) as caught:
            capabilities.operate(
                "designer", "job", "write",
                {"path": "a.html", "new_text": "x"},
            )
        message = str(caught.exception)
        self.assertIn("old_text", message)
        self.assertIn("content", message, "debe decir la alternativa, no solo el fallo")


if __name__ == "__main__":
    unittest.main()


class Resume(unittest.TestCase):
    """A prior run's outcome is evidence, not something to reproduce."""

    def test_the_previous_failure_becomes_attempt_one(self):
        # `tower-diseno` already exists in a failed state. Enqueuing it again
        # raised "Idempotency key reused" and the pursuit died before trying
        # anything — a resilience driver defeated by its own first step.
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn("previous = evidence_for", source)
        self.assertIn("first = 2", source)

    def test_a_finished_assignment_is_not_run_again(self):
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn('previous["status"] == "done"', source)


class WindowIsHonoured(unittest.TestCase):
    def test_the_rung_window_reaches_the_supervisor(self):
        # The ladder asked for 900s and the job was killed at 180: `tick` runs
        # with a fixed deadline, so the window the rung chose was ignored and
        # the retry died the same way the original did.
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn("supervisor.execute(job, timeout=window)", source)
        self.assertNotIn("supervisor.tick(1)", source)

    def test_a_supervisor_stop_is_read_as_evidence(self):
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn('action in ("incomplete", "stopped")', source)

    def test_a_timeout_now_classifies_as_a_timeout(self):
        self.assertEqual(pursue.classify({"reason": "timeout"}), "timeout")


class MalformedCallsAreLegible(unittest.TestCase):
    def test_a_missing_envelope_key_names_the_shape_expected(self):
        # `KeyError: 'args'` repeated twelve times in one design turn. The agent
        # could not fix a call when the only feedback was the missing key's name.
        import json as _json

        captured = {}
        source = (Path(__file__).parent / "capabilities.py").read_text()
        self.assertIn('"action" not in params or "args" not in params', source)
        self.assertIn("Ejemplo:", source, "debe mostrar la forma correcta")
        del captured, _json
