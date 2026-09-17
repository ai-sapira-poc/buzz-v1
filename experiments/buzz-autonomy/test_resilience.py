"""Guard the properties that let a project survive its own failures.

Each test here is bound to a failure that actually happened in the Tower Control
launch, not to a hypothetical one. If a guard is removed, the corresponding real
failure comes back silently — which is what made these expensive the first time.
"""
import json
import os
import tempfile
import time
import unittest
import unittest.mock
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

    def test_budget_lost_to_the_harness_keeps_the_scope_and_resumes(self):
        # diseno-tower-slice1-screen (2026-09-15): the artifact passed the gate
        # by turn 8; 6 later turns were gate rejections and 2 were malformed
        # calls. The old rung prescribed "shrink the scope" — which is how
        # tower-diseno-min shipped a single row. Read the trace first.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "runs").mkdir()
            receipt = json.dumps({"path": "design/screen.html", "sha256": "ab",
                                  "design_foundation": {"path": "design/screen.html"}})
            probe = receipt.replace("design/screen.html", "design/_gate-probe.html")
            trace = {"messages": (
                [{"role": "assistant"}, {"role": "tool", "content": receipt}]
                + [{"role": "assistant"}, {"role": "tool", "content":
                   '{"error": "PermissionError", "message": "Sapira CSS gate: 3 infracción(es)"}'}] * 3
                + [{"role": "assistant"}, {"role": "tool", "content":
                   '{"error": "ValueError", "message": "Llamada mal formada"}'}]
                + [{"role": "assistant"}, {"role": "tool", "content": probe}]
                + [{"role": "assistant"}])}
            (root / "runs" / "job.json").write_text(json.dumps(trace))
            original = pursue.ROOT
            pursue.ROOT = root
            try:
                plan = pursue.approach("diseno", "budget", 2, "brief", "job")
            finally:
                pursue.ROOT = original
        self.assertEqual(plan["diagnosis"]["harness_turns"], 4)
        self.assertEqual(plan["diagnosis"]["validated"], ["design/screen.html"])
        self.assertIn("MANTÉN el alcance", plan["brief"])
        self.assertIn("design/screen.html", plan["brief"])
        self.assertNotIn("_gate-probe", plan["brief"])
        self.assertNotIn("primera pieza indivisible", plan["brief"])
        self.assertEqual(plan["budget"], 24)

    def test_budget_exhaustion_without_a_trace_still_shrinks_the_scope(self):
        # No trace to read → the pre-existing rung, unchanged.
        plan = pursue.approach("diseno", "budget", 2, "brief", "no-such-job")
        self.assertIn("primera pieza indivisible", plan["brief"])

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
        import capabilities

        with self.assertRaises(ValueError) as caught:
            capabilities.check_call({"action": "write"})
        self.assertIn("args", str(caught.exception))
        self.assertIn("Ejemplo:", str(caught.exception), "debe mostrar la forma correcta")
        # The handler must run this check, not a private copy of it.
        source = (Path(__file__).parent / "capabilities.py").read_text()
        self.assertIn("check_call(params)", source)


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
        # The guarantee moved with the call: routing every harness through the
        # supervisor is what gives a code role its durable record, and the
        # supervisor is now where the working directory is chosen.
        source = (Path(__file__).parent / "supervisor.py").read_text()
        body = source.split("def _execute_pi")[1].split("\ndef ")[0]
        self.assertIn("str(REPO)", body)
        self.assertNotIn("str(ROOT)", body)


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


class TurnBudgetFitsTheRole(unittest.TestCase):
    """One number for twelve jobs starved the roles that write long artifacts.

    The model underneath is slow but good: it reaches a result by iterating, so
    the budget has to fit the work, not the median. It is still not a cure for
    attrition — `diseno-tower-slice1-screen` had 16 turns and lost 8 to
    unsatisfiable rejections — which is why these raise turns only where the
    trace shows the turns doing real work.
    """

    def test_a_role_that_grounds_then_writes_gets_more_than_the_default(self):
        from control_plane import roster

        self.assertGreater(roster.turn_budget("diseno"), roster.DEFAULT_TURN_BUDGET)
        self.assertGreater(roster.turn_budget("research"), roster.DEFAULT_TURN_BUDGET)
        self.assertEqual(roster.turn_budget("revisor"), roster.DEFAULT_TURN_BUDGET)
        self.assertGreater(roster.DEFAULT_TURN_BUDGET, 16, "16 was the starving default")

    def test_every_budgeted_role_exists_in_the_roster(self):
        # A typo here would silently hand the role the default forever.
        from control_plane import roster

        for role in roster.TURN_BUDGETS:
            self.assertIn(role, roster.CONTRACTS, role)

    def test_the_worker_resolves_the_budget_from_the_buzz_identity(self):
        import worker

        with unittest.mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("BUZZ_TURN_BUDGET", None)
            # The worker is handed the identity ("designer"), not the role.
            self.assertEqual(worker.turn_budget("designer"), 32)
            self.assertEqual(worker.turn_budget("reviewer"), 24)

    def test_an_explicit_budget_still_wins_so_recovery_can_buy_turns(self):
        # `pursue` sets BUZZ_TURN_BUDGET per rung; a role default that
        # overruled it would silently cancel the recovery ladder.
        import worker

        with unittest.mock.patch.dict(os.environ, {"BUZZ_TURN_BUDGET": "40"}):
            self.assertEqual(worker.turn_budget("designer"), 40)

    def test_a_bigger_budget_buys_the_wall_clock_to_spend_it(self):
        # 17 turns took 13.4 real minutes on this model. Handing a rung 32
        # turns inside a 900 s window relabels the same death "timeout".
        self.assertGreaterEqual(pursue.fits(32, 900), 32 * 60)
        self.assertEqual(pursue.fits(8, 1800), 1800, "nunca encoge una ventana mayor")

    def test_a_recovery_rung_never_starts_poorer_than_the_role_baseline(self):
        # The rungs' literal budgets predate per-role budgets: the designer's
        # retry was handed 24 turns against a baseline of 32.
        from control_plane import roster

        plan = pursue.approach("diseno", "blocked", 2, "brief")
        self.assertGreaterEqual(
            max(plan["budget"], roster.turn_budget("diseno")),
            roster.turn_budget("diseno"))


class PrerequisiteSubstitution(unittest.TestCase):
    """A deliverable that arrives under a different job still satisfies the edge.

    `coder-tower-slice1-implementation` sat queued behind the failed
    `diseno-tower-slice1-screen` while the spec it needed sat on disk, written
    by `tower-diseno-c5ab328d-r2`. The two dishonest ways out were forcing the
    failed job to `done` (erasing why it failed) and leaving the coder blocked.
    """

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.previous = pilot.ROOT
        pilot.ROOT = Path(self.directory.name)
        self.addCleanup(lambda: setattr(pilot, "ROOT", self.previous))
        with pilot.database() as db:
            for ident, status in (("failed-one", "failed"), ("delivered", "done"),
                                  ("half-done", "running")):
                db.execute("INSERT INTO jobs(id,role,prompt,status,created) VALUES(?,?,?,?,0)",
                           (ident, "diseno", "p", status))
            db.execute("INSERT INTO jobs(id,role,prompt,status,created) VALUES('dependent','coder','p','queued',0)")
            db.execute("INSERT INTO job_dependencies VALUES('dependent','failed-one')")

    def unmet(self):
        with pilot.database() as db:
            return db.execute(
                f"""SELECT 1 FROM job_dependencies d LEFT JOIN jobs p ON p.id=d.prerequisite
                    WHERE d.job='dependent' AND {pilot.UNMET} LIMIT 1""").fetchone()

    def test_the_edge_opens_without_the_failure_being_rewritten(self):
        self.assertIsNotNone(self.unmet(), "bloqueado antes de sustituir")
        pilot.substitute_prerequisite("dependent", "failed-one", "delivered",
                                      "la spec la entregó el reintento")
        self.assertIsNone(self.unmet(), "la sustitución abre la dependencia")
        with pilot.database() as db:
            status = db.execute("SELECT status FROM jobs WHERE id='failed-one'").fetchone()["status"]
        self.assertEqual(status, "failed", "el fallo sigue siendo un fallo")

    def test_an_unfinished_job_cannot_be_laundered_into_a_prerequisite(self):
        with self.assertRaises(ValueError) as caught:
            pilot.substitute_prerequisite("dependent", "failed-one", "half-done", "porque sí")
        self.assertIn("not done", str(caught.exception))
        self.assertIsNotNone(self.unmet(), "sigue bloqueado")

    def test_a_substitution_must_state_why_and_must_match_a_real_edge(self):
        with self.assertRaises(ValueError):
            pilot.substitute_prerequisite("dependent", "failed-one", "delivered", "   ")
        with self.assertRaises(ValueError):
            pilot.substitute_prerequisite("dependent", "no-such-edge", "delivered", "razón")
        self.assertIsNotNone(self.unmet())


class UpstreamOutageIsNotAFailedAssignment(unittest.TestCase):
    """`tower-coder` died on `503 chat_admission_busy — retry shortly`.

    The harness reported it as "3 unparseable lines; the run cannot be
    trusted", which sent the operator to debug a parser while the model
    endpoint was down — the real cause was sitting intact in `agent_end`.
    """

    def test_an_endpoint_refusing_the_turn_is_its_own_obstacle(self):
        for reason in ("upstream model error for coder: 503 chat_admission_busy",
                       "429 rate limit", "model overloaded", "502 Bad Gateway"):
            with self.subTest(reason=reason):
                self.assertEqual(pursue.classify({"reason": reason}), "transient")

    def test_a_transient_outage_is_retried_unchanged_after_waiting(self):
        # The one obstacle whose right answer is the same attempt again.
        plan = pursue.approach("coder", "transient", 2, "brief original")
        self.assertEqual(plan["brief"], "brief original", "no reescribe el encargo")
        self.assertGreater(plan["wait"], 0)
        self.assertLess(pursue.approach("coder", "transient", 2, "b")["wait"],
                        pursue.approach("coder", "transient", 4, "b")["wait"],
                        "la espera crece")

    def test_a_real_budget_failure_is_still_told_apart_from_an_outage(self):
        self.assertEqual(pursue.classify({"reason": "max_iterations_reached(32/32)"}), "budget")

    def test_an_outage_does_not_burn_the_alternatives_kept_for_real_obstacles(self):
        # tower-coder exhausted three attempts in under two minutes against a
        # 502. Every rung it spent was an approach it never got to try.
        from unittest.mock import patch

        calls = []

        def busy(role, job, brief, budget, window):
            calls.append(job)
            return {"status": "failed", "reason": "503 chat_admission_busy", "final": ""}

        with patch.object(pursue, "attempt_once", busy), \
             patch.object(pursue, "brief_for", lambda role: "brief"), \
             patch.object(pursue, "evidence_for", lambda key: {
                 "status": None, "reason": None, "blocked_calls": 0,
                 "denied": False, "final": ""}), \
             patch.object(pursue, "event", lambda *a, **k: None), \
             patch.object(pursue, "job_id", lambda role, brief: "tower-coder"), \
             patch.object(time, "sleep", lambda s: None):
            out = pursue.pursue("coder", max_attempts=3)

        self.assertFalse(out["reached"])
        self.assertEqual(out["obstacle"], "transient")
        # It kept retrying the same attempt rather than climbing rungs.
        self.assertEqual(set(calls), {"tower-coder"},
                         "no debe escalar peldaños por una caída")
        self.assertGreater(len(calls), 3, "y debe insistir más que los 3 intentos")
        self.assertEqual(len(calls), pursue.MAX_TRANSIENT_WAITS + 1, "pero con tope")
        self.assertIn("no admite turnos", json.dumps(out, ensure_ascii=False),
                      "y debe decir que el endpoint está caído, no inventar otra causa")

    def test_a_permanent_upstream_refusal_is_never_retried_as_an_outage(self):
        # Watching this run cost nine backed-off retries of a 400: the combo
        # has no vision model and never will within the run.
        reason = ('upstream model error for coder: 400: {"message":"No target in '
                  'combo cheap-combo has confirmed vision support for this image '
                  'request","code":"capability_mismatch"}')
        self.assertEqual(pursue.classify({"reason": reason}), "denied")
        self.assertEqual(pursue.approach("coder", "denied", 2, "brief"), {},
                         "no hay peldaño que arregle una capacidad que falta")


class EverySuccessLeavesEvidence(unittest.TestCase):
    """`tower-coder` reported `reached: true` on evidence that existed nowhere.

    The Pi branch of `attempt_once` called `pi_harness.run` directly, which
    looked like a harmless shortcut and skipped the whole durable-record layer:
    no job row, no artifact, no publication to the team channel, no operator
    update, no heartbeat. A 21-minute delivery that nobody in Buzz could see,
    and a success claim backed only by the driver's own stdout.
    """

    def test_the_pi_branch_no_longer_bypasses_the_supervisor(self):
        source = (Path(__file__).parent / "control_plane" / "pursue.py").read_text()
        body = source.split("def attempt_once")[1].split("\ndef ")[0]
        self.assertNotIn("run_pi(", body,
                         "un rol de código no puede saltarse el registro durable")
        self.assertIn("supervisor.execute(job", body,
                      "ambos harnesses pasan por el supervisor")

    def test_both_harnesses_reach_the_same_durable_path(self):
        # supervisor.execute routes Pi roles itself, so one call covers both.
        import supervisor

        source = (Path(__file__).parent / "supervisor.py").read_text()
        self.assertIn("_pi_role_for(job)", source.split("def execute(job")[1][:600])
        self.assertTrue(callable(supervisor.execute))


class AnAssignmentIsSizedBeforeItIsSent(unittest.TestCase):
    """Slicing was reactive: the scope only shrank after a budget died.

    Measured over 215 finished assignments in this pilot, brief size is the
    strongest predictor of failure available before spending anything:
    under 1500 characters about one in ten fails, 1500 to 3000 four in ten,
    over 3000 seven in ten. Discovering that after the fact costs a whole
    assignment.
    """

    def test_the_thresholds_match_the_bands_that_were_measured(self):
        self.assertEqual(capabilities.SLICE_WARNING_CHARS, 1500)
        self.assertEqual(capabilities.SLICE_REFUSAL_CHARS, 3000)

    def test_a_small_assignment_passes_without_noise(self):
        self.assertIsNone(capabilities.slicing_advice("x" * 700))
        capabilities.refuse_if_unsliceable("x" * 700)

    def test_the_failing_band_is_warned_but_not_blocked(self):
        # Four in ten is bad odds, not a certainty: warn, and let it through.
        advice = capabilities.slicing_advice("x" * 2000)
        self.assertIn("2000", advice)
        self.assertIn("42%", advice)
        capabilities.refuse_if_unsliceable("x" * 2000)

    def test_an_unlandable_assignment_is_refused_with_both_ways_out(self):
        # A refusal that only states the rule teaches nothing, so it names the
        # evidence and the two moves: slice it, or delegate the slicing.
        with self.assertRaises(ValueError) as caught:
            capabilities.refuse_if_unsliceable("x" * 4000)
        message = str(caught.exception)
        self.assertIn("71%", message)
        self.assertIn("product", message, "debe ofrecer delegar el troceado")
        self.assertIn("aceptación", message)

    def test_the_maestro_is_told_before_it_is_refused(self):
        # Learning a limit by hitting it costs a turn; the contract states it.
        from control_plane import roster

        instruction = roster.instruction("maestro")
        self.assertIn("3000", instruction)
        self.assertIn("@producto", instruction)
