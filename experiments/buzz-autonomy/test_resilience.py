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


class PiHarnessUsesTheBuzzFork(unittest.TestCase):
    def test_the_role_contract_travels_through_the_harness_prompt_seam(self):
        # Writing the contract to a file and trusting pi to find it was never
        # verified. `buzz-acp` reads BUZZ_ACP_SYSTEM_PROMPT_FILE itself and
        # sends the composed prompt as `_meta.systemPrompt` — but only to the
        # Buzz fork, which identifies itself as `buzz-pi-acp`.
        source = (Path(__file__).parent / "control_plane/run_pi_agent.py").read_text()
        self.assertIn("BUZZ_ACP_SYSTEM_PROMPT_FILE", source)
        self.assertIn('shutil.which("buzz-pi-acp")', source)
        self.assertNotIn('shutil.which("pi-acp")', source)


class PortfolioSeesEverything(unittest.TestCase):
    def test_a_role_with_no_queue_row_is_named_not_omitted(self):
        # The pi roles leave no row in the jobs table. Omitted, they read as
        # "nothing to worry about" — the most expensive kind of silence.
        import diagnosis

        self.assertIn("tower", diagnosis._expected("tower") and "tower")
        self.assertTrue(diagnosis._expected("tower"), "las asignaciones deben resolverse")
        self.assertEqual(diagnosis._expected("otro-proyecto"), {})

    def test_a_repeated_wall_outranks_the_budget_it_burned(self):
        import diagnosis

        job = {"status": "failed", "started": 0, "created": 0, "events": [
            {"action": "tool_error", "at": 1,
             "data": '{"action":"write","message":"bloqueado","repeat":9}'},
            {"action": "incomplete", "at": 2, "data": '{"reason":"max_iterations"}'},
        ]}
        verdict, evidence = diagnosis._obstacle(job, 100)
        self.assertEqual(verdict, "blocked")
        self.assertIn("9x", evidence)


class CodeRolesWorkInTheRepo(unittest.TestCase):
    def test_a_pi_attempt_runs_in_the_repository(self):
        # Started in the pilot home, a code role cannot see desktop/src at all,
        # so it reports "not found" for files that are right there — a wrong
        # answer dressed as a finding.
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn("run_pi(role, brief, str(REPO)", source)
        self.assertNotIn("run_pi(role, brief, str(ROOT)", source)


class RungsActuallyRun(unittest.TestCase):
    def test_a_previously_failed_rung_is_requeued_before_running(self):
        # enqueue is idempotent, so a rung that already failed comes back as the
        # same failed row, and execute skips anything not queued — returning in
        # 0s. The pursuit then reports an exhausted ladder having tried nothing,
        # which is worse than failing: it looks like effort.
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn("UPDATE jobs SET status='queued'", source)
        self.assertIn("status!='done'", source, "no debe reencolar lo ya hecho")


class TheDriverSurvivesTheFailuresItExistsFor(unittest.TestCase):
    def test_a_crashing_attempt_is_classified_not_propagated(self):
        # The architect's TimeoutExpired propagated out of the pi harness and
        # killed the pursuit on attempt 1 — a resilience driver defeated by the
        # exact failure it was written to climb past.
        source = (Path(__file__).parent / "control_plane/pursue.py").read_text()
        self.assertIn("attempt_crashed", source)
        self.assertIn("except Exception as error", source)

    def test_a_crash_reason_still_reaches_the_ladder(self):
        from control_plane import pursue

        self.assertEqual(
            pursue.classify({"reason": "TimeoutExpired: Command ... timed out"}),
            "timeout",
        )


class BriefsMatchTheHarness(unittest.TestCase):
    def test_a_code_role_is_not_told_it_cannot_read_the_repository(self):
        # It was told exactly that while being asked to inspect
        # desktop/src/features/pulse/. It burned its whole window and returned
        # nothing — a contradiction in the brief costs a full run.
        from control_plane.tower_project import brief_for

        architect = brief_for("arquitecto")
        self.assertIn("which you can read", architect)
        self.assertNotIn("does not reach", architect)

    def test_a_business_role_is_still_told_the_truth_about_its_reach(self):
        from control_plane.tower_project import brief_for

        self.assertIn("does not reach", brief_for("diseno"))

    def test_every_code_role_gets_the_repository_scope(self):
        # The contradiction cost a whole run once with one role; the roster now
        # has three on the code plane, so bind the property to all of them
        # rather than to the one that happened to fail.
        from control_plane.roster import CONTRACTS, PI
        from control_plane.tower_project import ASSIGNMENTS, brief_for

        for role in ASSIGNMENTS:
            with self.subTest(role=role):
                text = brief_for(role)
                if CONTRACTS[role]["harness"] == PI:
                    self.assertIn("which you can read", text)
                else:
                    self.assertIn("does not reach", text)


class TheDeliverableIsAFeature(unittest.TestCase):
    """Tower Control is a section in the desktop app, not a folder of documents.

    This was conflated for most of a session: the NIP-MP project and the
    `tower-control` channel are scaffolding for the team's own coordination, and
    they were treated as the product. The design role shipped a standalone HTML
    prototype and declared its own limit — `professional_acceptance: false`,
    because the pilot gate validates a token dialect in standalone HTML, not
    adoption of the desktop's components. A prototype is an input to a feature.
    """

    def test_the_shared_frame_names_the_deliverable_and_the_scaffolding(self):
        from control_plane.tower_project import SHARED

        self.assertIn("desktop", SHARED)
        self.assertIn("FeatureGate", SHARED)
        self.assertIn("scaffolding", SHARED)

    def test_someone_is_assigned_to_actually_ship_it(self):
        # Eight roles produced analysis and nobody wrote the feature. A plan
        # where no assignment lands in the repository cannot finish.
        from control_plane.roster import CONTRACTS, PI
        from control_plane.tower_project import ASSIGNMENTS

        shippers = [r for r in ASSIGNMENTS if CONTRACTS[r]["harness"] == PI]
        self.assertIn("coder", shippers)
        self.assertIn("desktop/", ASSIGNMENTS["coder"]["brief"])

    def test_the_open_problem_is_assigned_rather_than_noted(self):
        # `run.status = blocked` has no producer. It was carried as a footnote
        # across three failed assignments; a problem nobody owns stays open.
        from control_plane.tower_project import ASSIGNMENTS, SHARED

        self.assertIn("run.status = blocked", SHARED)
        self.assertIn("run.status = blocked", ASSIGNMENTS["arquitecto"]["brief"])

    def test_the_order_is_a_valid_topological_sort(self):
        from control_plane.tower_project import ASSIGNMENTS, ORDER

        self.assertEqual(set(ORDER), set(ASSIGNMENTS))
        done: set[str] = set()
        for role in ORDER:
            with self.subTest(role=role):
                for dependency in ASSIGNMENTS[role]["depends_on"]:
                    self.assertIn(dependency, done,
                                  f"{role} corre antes que {dependency}")
            done.add(role)

    def test_every_assignment_names_a_real_roster_identity(self):
        from control_plane.roster import CONTRACTS
        from control_plane.tower_project import ASSIGNMENTS

        for role, assignment in ASSIGNMENTS.items():
            with self.subTest(role=role):
                self.assertIn(role, CONTRACTS)
                self.assertEqual(assignment["identity"],
                                 CONTRACTS[role]["identity"])


class ARewrittenBriefDoesNotResume(unittest.TestCase):
    """A finished answer to the old wording is not an answer to the new one.

    Measured: the Tower Control assignments were rewritten from "produce
    analysis" to "ship a feature in desktop/", and both product and research
    returned `done` in under a second by resuming the previous run. The goal
    had changed, the answer had not, and the pursuit reported success.
    """

    def setUp(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        import pilot

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = patch.object(pilot, "ROOT", Path(self.temp.name))
        root.start()
        self.addCleanup(root.stop)
        self.pilot = pilot

    def test_an_unrun_role_uses_the_plain_key(self):
        from control_plane.pursue import job_id

        self.assertEqual(job_id("producto", "el encargo"), "tower-producto")

    def test_the_same_brief_keeps_the_same_key(self):
        from control_plane.pursue import job_id

        self.pilot.enqueue("product", "el encargo", "tower-producto")
        self.assertEqual(job_id("producto", "el encargo"), "tower-producto")

    def test_a_changed_brief_gets_its_own_key(self):
        # Not merely "a different key": `enqueue` refuses to reuse a key with a
        # different payload, so reusing it would raise rather than re-run.
        from control_plane.pursue import job_id

        self.pilot.enqueue("product", "el encargo viejo", "tower-producto")
        key = job_id("producto", "el encargo nuevo")
        self.assertNotEqual(key, "tower-producto")
        self.assertTrue(key.startswith("tower-producto-"))

    def test_the_old_run_is_kept_rather_than_overwritten(self):
        # The previous answer stays readable next to the question it actually
        # answered; a rewrite is not a reason to lose the record.
        from control_plane.pursue import answered_brief, job_id

        self.pilot.enqueue("product", "el encargo viejo", "tower-producto")
        job_id("producto", "el encargo nuevo")
        self.assertEqual(answered_brief("tower-producto"), "el encargo viejo")

    def test_the_key_is_stable_for_one_wording(self):
        from control_plane.pursue import job_id

        self.pilot.enqueue("product", "viejo", "tower-producto")
        self.assertEqual(job_id("producto", "nuevo"), job_id("producto", "nuevo"))
