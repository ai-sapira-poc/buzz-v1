"""Regression tests for the Tower launcher's durable, visible state machine."""
from contextlib import nullcontext
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pilot
from control_plane import launch_tower, telemetry


class TowerLauncher(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(pilot, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.artifacts_patch = patch.object(launch_tower, "ARTIFACTS",
                                            self.root / "artifacts" / "tower")
        self.artifacts_patch.start()
        self.addCleanup(self.artifacts_patch.stop)
        self.assignment_patch = patch.object(
            telemetry, "assignment", return_value=nullcontext(SimpleNamespace())
        )
        self.assignment_patch.start()
        self.addCleanup(self.assignment_patch.stop)
        self.flush_patch = patch.object(telemetry, "flush")
        self.flush_patch.start()
        self.addCleanup(self.flush_patch.stop)
        # Architecture is intentionally dependent on the completed product
        # handoff; direct dispatch tests must seed that prerequisite just as
        # the real ordered launcher does.
        pilot.enqueue("product", launch_tower.brief_for("producto"),
                      "tower-producto")
        with pilot.database() as db:
            db.execute("UPDATE jobs SET status='done' WHERE id='tower-producto'")

    def _publish_spy(self):
        published = []

        def publish(role, job, text):
            published.append((role, job, text))
            return {"event_id": f"event-{len(published)}"}

        return published, publish

    def test_pi_is_durable_and_publishes_before_done(self):
        published, publish = self._publish_spy()
        record = {"final": "architectural handoff", "trace_id": "trace-1",
                  "usage": {}, "events": 3}
        with patch("control_plane.pi_harness.run", return_value=record), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            result = launch_tower.dispatch_pi("arquitecto", dry_run=False)

        self.assertIn("hecho", result)
        self.assertEqual(published[0][0], "architect")
        self.assertIn("Trabajo en marcha", published[0][2])
        self.assertEqual(published[1][2], "architectural handoff")
        self.assertIn("Avance confirmado", published[2][2])
        with pilot.database() as db:
            row = db.execute(
                "SELECT status,attempts,result FROM jobs WHERE id='tower-arquitecto'"
            ).fetchone()
            self.assertEqual((row["status"], row["attempts"], row["result"]),
                             ("done", 1, "architectural handoff"))
            actions = [r[0] for r in db.execute(
                "SELECT action FROM events WHERE job='tower-arquitecto' ORDER BY seq"
            )]
        self.assertIn("assignment_started", actions)
        self.assertIn("handoff_published", actions)
        self.assertIn("assignment_finished", actions)
        self.assertLess(actions.index("assignment_started"),
                         actions.index("handoff_published"))

    def test_pi_failure_is_persisted_and_visible(self):
        published, publish = self._publish_spy()
        failure = subprocess.TimeoutExpired("pi", launch_tower.PI_TIMEOUT)
        with patch("control_plane.pi_harness.run", side_effect=failure), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            with self.assertRaises(subprocess.TimeoutExpired):
                launch_tower.dispatch_pi("arquitecto", dry_run=False)

        with pilot.database() as db:
            row = db.execute(
                "SELECT status,attempts,result FROM jobs WHERE id='tower-arquitecto'"
            ).fetchone()
            actions = [r[0] for r in db.execute(
                "SELECT action FROM events WHERE job='tower-arquitecto' ORDER BY seq"
            )]
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["attempts"], 1)
        self.assertIn("TimeoutExpired", row["result"])
        self.assertIn("assignment_failed", actions)
        self.assertTrue(any("Incidencia en el trabajo" in text for _, _, text in published))

    def test_failed_handoff_cannot_be_marked_done(self):
        calls = []

        def publish(role, job, text):
            calls.append(text)
            if text == "architectural handoff":
                raise RuntimeError("relay unavailable")
            return {"event_id": "status-event"}

        record = {"final": "architectural handoff", "trace_id": "trace-1",
                  "usage": {}, "events": 3}
        with patch("control_plane.pi_harness.run", return_value=record), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            with self.assertRaises(RuntimeError):
                launch_tower.dispatch_pi("arquitecto", dry_run=False)

        with pilot.database() as db:
            row = db.execute(
                "SELECT status,result FROM jobs WHERE id='tower-arquitecto'"
            ).fetchone()
        self.assertEqual(row["status"], "failed")
        self.assertIn("relay unavailable", row["result"])
        self.assertNotIn("done", " ".join(calls))

    def test_explicit_cancellation_is_not_rewritten_as_failure(self):
        published, publish = self._publish_spy()

        def cancel_then_crash(*_args, **_kwargs):
            with pilot.database() as db:
                db.execute("UPDATE jobs SET status='cancelled' "
                           "WHERE id='tower-arquitecto'")
            raise RuntimeError("cancelled by operator")

        with patch("control_plane.pi_harness.run", side_effect=cancel_then_crash), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                launch_tower.dispatch_pi("arquitecto", dry_run=False)

        with pilot.database() as db:
            row = db.execute(
                "SELECT status,result FROM jobs WHERE id='tower-arquitecto'"
            ).fetchone()
            actions = [r[0] for r in db.execute(
                "SELECT action FROM events WHERE job='tower-arquitecto' ORDER BY seq"
            )]
        self.assertEqual(row["status"], "cancelled")
        self.assertIn("assignment_cancelled", actions)
        self.assertNotIn("assignment_failed", actions)
        self.assertTrue(any("Trabajo cancelado" in text for _, _, text in published))

    def test_published_handoff_is_recovered_without_running_pi_twice(self):
        published, publish = self._publish_spy()
        record = {"final": "architectural handoff", "trace_id": "trace-1",
                  "usage": {}, "events": 3}
        with patch("control_plane.pi_harness.run", return_value=record) as run, \
                patch.object(launch_tower, "_finish",
                             side_effect=RuntimeError("local finalize failed")), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            with self.assertRaisesRegex(RuntimeError, "local finalize"):
                launch_tower.dispatch_pi("arquitecto", dry_run=False)

        with patch("control_plane.pi_harness.run",
                   side_effect=AssertionError("published handoff must be reused")), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            result = launch_tower.dispatch_pi("arquitecto", dry_run=False)

        self.assertIn("recuperado", result)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(sum(text == "architectural handoff" for _, _, text in published), 1)
        with pilot.database() as db:
            row = db.execute(
                "SELECT status,attempts,result FROM jobs WHERE id='tower-arquitecto'"
            ).fetchone()
        self.assertEqual((row["status"], row["attempts"], row["result"]),
                         ("done", 2, "architectural handoff"))

    def test_coder_is_blocked_when_architecture_is_not_done(self):
        pilot.enqueue("product", launch_tower.brief_for("producto"),
                      "tower-producto")
        with pilot.database() as db:
            db.execute("UPDATE jobs SET status='done' WHERE id='tower-producto'")
        pilot.enqueue("architect", launch_tower.brief_for("arquitecto"),
                      "tower-arquitecto", depends_on=["tower-producto"])
        with pilot.database() as db:
            db.execute("UPDATE jobs SET status='failed',result='no handoff' "
                       "WHERE id='tower-arquitecto'")

        published, publish = self._publish_spy()
        with patch.object(launch_tower, "config",
                          return_value={"relay": "http://relay", "model": "test"}), \
                patch.object(launch_tower, "dispatch_pi",
                             side_effect=AssertionError("coder must not start")), \
                patch("reporting.publish", side_effect=publish), \
                patch("reporting.speak", side_effect=publish):
            result = launch_tower.main(dry_run=False, only="coder")

        self.assertEqual(result, 0)
        self.assertTrue(any("Trabajo en espera" in text for _, _, text in published))
        with pilot.database() as db:
            row = db.execute(
                "SELECT status FROM jobs WHERE id='tower-coder'"
            ).fetchone()
        self.assertIsNone(row)


class LongRunningHarness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        from control_plane import pi_harness

        self.harness = pi_harness
        self.root_patch = patch.object(pi_harness, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.telemetry_patch = patch.object(
            telemetry, "turn", return_value=nullcontext(SimpleNamespace())
        )
        self.telemetry_patch.start()
        self.addCleanup(self.telemetry_patch.stop)
        self.usage_patch = patch.object(telemetry, "record_usage")
        self.usage_patch.start()
        self.addCleanup(self.usage_patch.stop)

    def _fake_pi(self, body: str) -> Path:
        script = self.root / "fake-pi.py"
        script.write_text("#!/usr/bin/env python3\n" + body, encoding="utf-8")
        script.chmod(0o700)
        return script

    def test_slow_model_outlives_old_short_cap_without_being_failed(self):
        script = self._fake_pi(
            "import json, time\n"
            "print(json.dumps({'type':'agent_end','messages':[{'role':'assistant',"
            "'content':[{'type':'text','text':'slow handoff'}]}]}), flush=True)\n"
            "time.sleep(0.2)\n"
        )
        checkpoint = self.root / "checkpoints" / "slow.jsonl"
        with patch.object(self.harness, "PI_BIN", str(script)):
            result = self.harness.run("arquitecto", "brief", str(self.root),
                                     job="tower-slow", checkpoint_path=checkpoint)

        self.assertIsNone(self.harness.DEFAULT_TIMEOUT)
        self.assertEqual(result["final"], "slow handoff")
        self.assertIn('"agent_end"', checkpoint.read_text(encoding="utf-8"))
        self.assertTrue((self.root / "runs" / "pi-sessions").is_dir())

    def test_explicit_diagnostic_timeout_kills_the_whole_process_group(self):
        child_pid_file = self.root / "child.pid"
        script = self._fake_pi(
            "import os, subprocess, sys, time\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
            "open(os.environ['CHILD_PID_FILE'], 'w').write(str(child.pid))\n"
            "print('{\\\"type\\\":\\\"turn_start\\\"}', flush=True)\n"
            "time.sleep(30)\n"
        )
        checkpoint = self.root / "checkpoints" / "timeout.jsonl"
        with patch.dict(os.environ, {"CHILD_PID_FILE": str(child_pid_file)}), \
                patch.object(self.harness, "PI_BIN", str(script)):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.harness.run("arquitecto", "brief", str(self.root), timeout=0.2,
                                 job="tower-timeout", checkpoint_path=checkpoint)

        self.assertTrue(checkpoint.is_file())
        child_pid = int(child_pid_file.read_text(encoding="utf-8"))
        for _ in range(10):
            try:
                os.kill(child_pid, 0)
            except OSError:
                break
            time.sleep(0.1)
        else:
            self.fail("diagnostic timeout left a child process running")

    def test_explicit_cancel_stops_without_claiming_a_result(self):
        script = self._fake_pi(
            "import time\n"
            "print('{\\\"type\\\":\\\"turn_start\\\"}', flush=True)\n"
            "time.sleep(30)\n"
        )
        checkpoint = self.root / "checkpoints" / "cancel.jsonl"
        cancel = self.root / "cancel" / "tower-cancel.cancel"
        cancel.parent.mkdir(parents=True)
        cancel.touch()
        with patch.object(self.harness, "PI_BIN", str(script)):
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                self.harness.run("arquitecto", "brief", str(self.root),
                                 job="tower-cancel", checkpoint_path=checkpoint,
                                 cancel_path=cancel)
        self.assertTrue(checkpoint.is_file())

    def test_long_running_heartbeat_is_sampled_to_operator(self):
        from supervisor import _pi_heartbeats

        with patch.dict(os.environ, {
            "BUZZ_HEARTBEAT_INTERVAL": "1",
            "BUZZ_OPERATOR_HEARTBEAT_INTERVAL": "1",
        }, clear=False), patch("supervisor.event"), \
                patch("operator_updates.publish_update") as publish:
            with _pi_heartbeats("slow-job", "architect", "trace-1", "arquitecto"):
                time.sleep(1.15)

        publish.assert_called()
        self.assertEqual(publish.call_args.args[:4],
                         ("architect", "arquitecto", "slow-job", "running"))


class RuntimePolicy(unittest.TestCase):
    def test_long_running_defaults_have_no_outer_lifetime(self):
        from control_plane import runtime_policy

        with patch.dict(os.environ, {}, clear=True):
            args = runtime_policy.acp_args()
            self.assertIn("604800", args)
            self.assertIn("604700", args)
            self.assertNotIn("--exit-after-inactivity", args)
            self.assertIsNone(runtime_policy.wait_timeout(None))

    def test_diagnostic_acp_limit_derives_a_valid_idle_window(self):
        from control_plane import runtime_policy

        with patch.dict(os.environ, {"BUZZ_ACP_MAX_TURN_DURATION": "3600"}, clear=True):
            args = runtime_policy.acp_args()
        self.assertEqual(args[:4], ["--idle-timeout", "3599",
                                    "--max-turn-duration", "3600"])

    def test_pursuit_only_uses_a_wall_cap_when_operator_sets_one(self):
        from control_plane import pursue

        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(pursue.hard_timeout())
        with patch.dict(os.environ, {"BUZZ_PILOT_HARD_TIMEOUT": "42"}, clear=True):
            self.assertEqual(pursue.hard_timeout(), 42)


class OperatorCommunication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root_patch = patch.object(pilot, "ROOT", Path(self.temp.name))
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def test_user_update_leads_with_business_meaning(self):
        from operator_updates import format_update

        text = format_update("architect", "started", detail="trace-abc")
        self.assertIn("Objetivo:", text)
        self.assertIn("Estado: en curso", text)
        self.assertIn("Próxima señal:", text)
        self.assertIn("Detalle técnico: trace-abc", text)
        self.assertNotIn("AC-", text.split("Detalle técnico:", 1)[0])

    def test_technical_report_is_secondary_to_operator_summary(self):
        from operator_updates import result_header

        text = result_header("architect")
        self.assertIn("Estado:", text)
        self.assertIn("Impacto:", text)
        self.assertIn("Siguiente acción:", text)
        self.assertNotIn("trace-", text)

    def test_delegation_update_is_idempotent(self):
        from operator_updates import publish_delegation

        sent = []

        def speak(role, job, text):
            sent.append((role, job, text))
            return {"event_id": "visible-once"}

        with patch("reporting.speak", side_effect=speak):
            publish_delegation("maestro", "architect", "arq-job")
            publish_delegation("maestro", "architect", "arq-job")

        self.assertEqual(len(sent), 1)
        self.assertIn("Trabajo encargado", sent[0][2])
        self.assertIn("pendiente de inicio", sent[0][2])
        self.assertIn("Arquitectura", sent[0][2])

    def test_delegation_with_unfinished_dependency_is_visible_as_waiting(self):
        from operator_updates import publish_delegation

        pilot.enqueue("architect", "architecture", "architecture-job")
        sent = []

        def speak(role, job, text):
            sent.append(text)
            return {"event_id": "visible-wait"}

        with patch("reporting.speak", side_effect=speak):
            publish_delegation("maestro", "coder", "coder-job",
                               dependencies=["architecture-job"])

        self.assertEqual(len(sent), 1)
        self.assertIn("Trabajo en espera", sent[0])
        self.assertIn("Arquitectura", sent[0])
        self.assertNotIn("architecture-job", sent[0])

    def test_summary_names_movement_and_attention_without_job_protocol(self):
        from operator_updates import summarize_children

        text = summarize_children([
            {"role": "architect", "status": "done"},
            {"role": "designer", "status": "failed"},
            {"role": "reviewer", "status": "queued"},
        ])
        self.assertIn("1 de 3 encargos completados", text)
        self.assertIn("Requieren atención: Diseño", text)
        self.assertIn("En curso: Revisión independiente", text)
        self.assertNotIn("arq-job", text)


if __name__ == "__main__":
    unittest.main()


class StaleLeaseRecovery(unittest.TestCase):
    """A Pi job whose supervisor died must not stay `running` forever."""

    def setUp(self):
        import supervisor

        self.supervisor = supervisor
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(pilot, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        pilot.enqueue("architect", "verify the frontier", "arq-stale")

    def _mark_running(self, silent_for: float, attempts: int = 1) -> None:
        with pilot.database() as db:
            db.execute(
                "UPDATE jobs SET status='running',started=?,attempts=? WHERE id='arq-stale'",
                (time.time() - silent_for, attempts),
            )

    def _status(self) -> tuple[str, int]:
        with pilot.database() as db:
            row = db.execute(
                "SELECT status,attempts FROM jobs WHERE id='arq-stale'"
            ).fetchone()
        return row["status"], row["attempts"]

    def test_tick_requeues_a_pi_job_whose_heartbeat_stopped(self):
        self._mark_running(silent_for=self.supervisor.LEASE_TTL * 10)
        with patch.object(self.supervisor, "execute", return_value=True) as execute:
            self.supervisor.tick(1)

        execute.assert_called_once_with("arq-stale")
        with pilot.database() as db:
            recovered = db.execute(
                "SELECT data FROM events WHERE job='arq-stale' AND action='stale_recovered'"
            ).fetchall()
        self.assertEqual(len(recovered), 1)
        self.assertIn('"requeued": true', recovered[0]["data"])

    def test_a_slow_but_alive_pi_job_is_left_alone(self):
        self._mark_running(silent_for=self.supervisor.LEASE_TTL * 10)
        pilot.event("arq-stale", "architect", "assignment_heartbeat", {"beat": 400})
        with patch.object(self.supervisor, "execute", return_value=True) as execute:
            self.supervisor.tick(1)

        execute.assert_not_called()
        self.assertEqual(self._status(), ("running", 1))

    def test_exhausted_attempts_become_a_visible_failure_not_a_requeue(self):
        self._mark_running(silent_for=self.supervisor.LEASE_TTL * 10,
                           attempts=self.supervisor.MAX_ATTEMPTS)
        with patch.object(self.supervisor, "execute", return_value=True) as execute:
            self.supervisor.tick(1)

        execute.assert_not_called()
        self.assertEqual(self._status(), ("failed", self.supervisor.MAX_ATTEMPTS))
