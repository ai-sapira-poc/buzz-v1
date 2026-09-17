"""Bounded local queue runner; no permanent cron, deployment or background service."""
import argparse
from contextlib import contextmanager
import json
import os
import signal
import subprocess
import time
from pathlib import Path

from pilot import ROOT, REPO, PYTHON, UNMET, database, enqueue, event, write_json

# A running Pi job proves it is alive with `assignment_heartbeat` events every
# BUZZ_HEARTBEAT_INTERVAL seconds. When the supervisor process itself dies
# (kill, crash, reboot) the row stays `running` with no one behind it, and
# nothing else in this file ever looks at a `running` row again. The lease TTL
# is the silence after which that row is treated as abandoned. It is measured
# in missed heartbeats, not in model time, so a slow-but-alive turn is never
# affected: its heartbeats keep arriving.
LEASE_TTL = int(os.environ.get("BUZZ_JOB_LEASE_TTL", "120"))
if LEASE_TTL <= int(os.environ.get("BUZZ_HEARTBEAT_INTERVAL", "30")):
    raise ValueError("BUZZ_JOB_LEASE_TTL must be greater than BUZZ_HEARTBEAT_INTERVAL")
MAX_ATTEMPTS = 3


def _pi_role_for(job: str) -> str | None:
    """Return the control-plane role when a queued job needs the Pi harness."""
    try:
        from control_plane.roster import CONTRACTS, IDENTITY_TO_ROLE, PI

        with database() as db:
            row = db.execute("SELECT role FROM jobs WHERE id=?", (job,)).fetchone()
        role = IDENTITY_TO_ROLE.get(row["role"]) if row else None
        return role if role and CONTRACTS[role]["harness"] == PI else None
    except (ImportError, KeyError):
        # Legacy pilot jobs have no control-plane contract and continue through
        # the Hermes worker below.
        return None


def _claim_pi(job: str) -> tuple[dict, str]:
    """Claim one delegated Pi job using the same dependency gates as Hermes."""
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
        if not row or row["status"] != "queued":
            raise ValueError("Pi job not queued")
        pending = db.execute(
            f"""SELECT 1 FROM job_dependencies d LEFT JOIN jobs p ON p.id=d.prerequisite
               WHERE d.job=? AND {UNMET} LIMIT 1""",
            (job,),
        ).fetchone()
        if pending:
            raise RuntimeError("Prerequisite results are not ready")
        parent_pending = db.execute(
            """SELECT 1 FROM jobs WHERE id=? AND status!='done'
               UNION ALL SELECT 1 FROM inbound WHERE job=? AND status!='done' LIMIT 1""",
            (row["parent"], row["parent"]),
        ).fetchone()
        if parent_pending:
            raise RuntimeError("Parent orchestration has not completed")
        if (ROOT / "PAUSED").exists():
            raise RuntimeError("Pilot paused")
        attempt = row["attempts"] + 1
        db.execute(
            "UPDATE jobs SET status='running',started=?,attempts=? WHERE id=?",
            (time.time(), attempt, job),
        )
        return dict(row), str(attempt)


@contextmanager
def _pi_heartbeats(job: str, role: str, trace_id: str | None = None,
                   operator_role: str | None = None):
    """Keep a local lease alive and sample long work into the community."""
    import threading

    interval = int(os.environ.get("BUZZ_HEARTBEAT_INTERVAL", "30"))
    if interval <= 0:
        raise ValueError("BUZZ_HEARTBEAT_INTERVAL must be positive")
    operator_interval = int(os.environ.get("BUZZ_OPERATOR_HEARTBEAT_INTERVAL", "300"))
    if operator_interval <= 0:
        raise ValueError("BUZZ_OPERATOR_HEARTBEAT_INTERVAL must be positive")
    stopped = threading.Event()
    started = time.monotonic()
    next_operator_signal = operator_interval
    beat = 0

    def emit() -> None:
        nonlocal beat, next_operator_signal
        while not stopped.wait(interval):
            beat += 1
            elapsed = int(time.monotonic() - started)
            event(job, role, "assignment_heartbeat", {
                "trace_id": trace_id, "interval_seconds": interval,
                "elapsed_seconds": elapsed, "beat": beat,
            })
            if operator_role and elapsed >= next_operator_signal:
                from operator_updates import publish_update

                publish_update(
                    role, operator_role, job, "running",
                    detail=f"latido {beat}; {elapsed}s desde el inicio",
                    key=f"pi-running-{beat}",
                )
                next_operator_signal += operator_interval

    thread = threading.Thread(target=emit, name=f"pilot-pi-heartbeat-{job}", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join(timeout=2)


def _worktree_state() -> set[str]:
    """What the repository looks like right now, as `path` entries.

    Used to tell what a failed code role actually left behind. `git status`
    knows; the control plane did not, so a run that wrote nine files and a
    whole feature module was reported as a bare failure and the operator had
    no way to learn the work existed.
    """
    try:
        done = subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO),
                              capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return set()
    if done.returncode:
        return set()
    return {line[3:].strip() for line in done.stdout.splitlines() if line[3:].strip()}


def _execute_pi(job: str, role: str) -> bool:
    """Run a delegated code role in Pi and preserve its handoff."""
    from control_plane import pi_harness, telemetry
    from control_plane.tower_project import CHANNEL
    from evidence import handoff
    from operator_updates import publish_update
    from reporting import publish

    row, attempt = _claim_pi(job)
    identity = row["role"]
    before = _worktree_state()
    checkpoint = ROOT / "runs" / "pi-checkpoints" / f"{job}.jsonl"
    cancel_path = ROOT / "runs" / "cancel" / f"{job}.cancel"
    trace_id = None
    try:
        with telemetry.assignment(job, role) as span:
            trace_id = telemetry.trace_id_of(span)
            event(job, identity, "trace_opened", {
                "trace_id": trace_id, "attempt": int(attempt), "channel": CHANNEL,
            })
            publish_update(identity, role, job, "started", key="pi-started")
            with _pi_heartbeats(job, identity, trace_id, role):
                record = pi_harness.run(
                    role,
                    row["prompt"] + "\n\n" + handoff(job),
                    str(REPO),
                    timeout=None,
                    job=job,
                    checkpoint_path=checkpoint,
                    cancel_path=cancel_path,
                    cancel_check=lambda: _job_cancelled(job),
                )
            telemetry.flush()
        final = record["final"]
        artifact = ROOT / "artifacts" / "tower" / f"{job}.md"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(final, encoding="utf-8")
        write_json(ROOT / "runs" / (job + ".json"), {
            "job": job, "role": identity, "attempt": int(attempt),
            **{key: value for key, value in record.items() if key != "final"},
        })
        receipt = publish(identity, job, final)
        event(job, identity, "handoff_published", {
            "event_id": receipt.get("event_id") if isinstance(receipt, dict) else None,
            "trace_id": record.get("trace_id") or trace_id,
            "artifact": str(artifact),
        })
        with database() as db:
            changed = db.execute(
                "UPDATE jobs SET status='done',result=? WHERE id=? AND status='running'",
                (final[:12000], job),
            ).rowcount
        if changed != 1:
            raise RuntimeError("Pi job changed state before completion")
        event(job, identity, "assignment_finished", {
            "attempt": int(attempt), "trace_id": record.get("trace_id") or trace_id,
        })
        publish_update(identity, role, job, "done", key="pi-done")
        return True
    except Exception as error:
        telemetry.flush()
        cancelled = _job_cancelled(job)
        # A code role that dies still leaves its edits on disk. Reporting only
        # the exception hid a run that had written nine files and a whole
        # feature module before its session poisoned itself — work that was
        # already passing the desktop suite. Say what is there; do not imply
        # it was reviewed or accepted.
        written = sorted(_worktree_state() - before)
        detail = str(error)
        if written:
            listing = ", ".join(written[:20]) + (" …" if len(written) > 20 else "")
            detail += f" | cambios sin revisar en el repositorio: {listing}"
            event(job, identity, "uncommitted_work_on_failure",
                  {"paths": written[:100], "count": len(written)})
        with database() as db:
            db.execute(
                "UPDATE jobs SET status=?,result=? WHERE id=? AND status='running'",
                ("cancelled" if cancelled else "failed",
                 f"{type(error).__name__}: {error}"[:12000]
                 + (f"\n\nCambios sin revisar: {listing}" if written else ""), job),
            )
        event(job, identity, "stopped", {
            "reason": "cancelled" if cancelled else "failed",
            "error": f"{type(error).__name__}: {error}"[:500],
            "changed_paths": len(written),
        })
        publish_update(identity, role, job, "cancelled" if cancelled else "failed",
                       detail=detail, key="pi-cancelled" if cancelled else "pi-failed")
        return False


def _job_cancelled(job: str) -> bool:
    with database() as db:
        row = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
    return bool(row and row["status"] == "cancelled")


def recover_stale_pi_leases(now: float | None = None) -> list[str]:
    """Requeue jobs left `running` by a supervisor that is no longer there.

    The checkpoint and session on disk are untouched: the next attempt runs
    with the same `--session-id`, so pi resumes rather than starts over. A job
    that has already used its attempts is marked failed instead, so the loss
    is visible rather than a row that looks busy forever.

    This once covered only Pi, because only Pi emitted a heartbeat: a Hermes
    worker killed mid-conversation was indistinguishable from one still
    thinking, so the safe reading was to leave it alone — and its dependents
    waited on a row that would never change. Now that `worker.heartbeat` beats
    too, silence means the same thing on both harnesses and both are covered.
    A job that never beat at all is still left alone: absence of evidence from
    a harness that does not report is not evidence of death.
    """
    now = time.time() if now is None else now
    with database() as db:
        rows = db.execute(
            """SELECT j.id, j.started, j.attempts,
                      (SELECT max(at) FROM events e
                       WHERE e.job=j.id AND e.action='assignment_heartbeat') AS heartbeat
               FROM jobs j WHERE j.status='running'"""
        ).fetchall()
    recovered = []
    for row in rows:
        if _pi_role_for(row["id"]) is None and not row["heartbeat"]:
            # A Hermes job that has not beaten once may predate the heartbeat,
            # or may simply be in its first interval. Either way there is no
            # evidence of death, and requeuing live work duplicates it.
            continue
        age = now - max(row["started"] or 0, row["heartbeat"] or 0)
        if age <= LEASE_TTL:
            continue
        requeue = row["attempts"] < MAX_ATTEMPTS
        with database() as db:
            changed = db.execute(
                "UPDATE jobs SET status=?,started=NULL,result=? WHERE id=? AND status='running'",
                ("queued" if requeue else "failed",
                 f"stale lease recovered after {age:.0f}s without heartbeat; "
                 "checkpoint and session kept", row["id"]),
            ).rowcount
        if changed:
            event(row["id"], "supervisor", "stale_recovered", {
                "lease_ttl_seconds": LEASE_TTL, "silent_seconds": int(age),
                "attempts": row["attempts"], "requeued": requeue,
            })
            recovered.append(row["id"])
    return recovered


def execute(job, timeout=None, runner=None):
    """Run a job until completion or explicit cancellation.

    A control-plane code role is routed to Pi, where its repository scope and
    persistent session are real. Other jobs retain the Hermes worker boundary.
    A missing timeout is deliberate for quality-first work. Both paths own
    their process tree and preserve a durable result.
    """
    if runner is None:
        role = _pi_role_for(job)
        if role is not None:
            return _execute_pi(job, role)
    return _execute_worker(job, timeout=timeout, runner=runner)


def _execute_worker(job, timeout=None, runner=None):
    """Run a job until completion or explicit cancellation.

    A missing timeout is deliberate for quality-first work. The supervisor
    still polls for pause/cancel and always owns the process group, so removing
    the wall-clock cap does not remove operational control.
    """
    logs = ROOT / "logs"; logs.mkdir(parents=True, exist_ok=True)
    with (logs / (job + ".log")).open("a") as output:
        process = subprocess.Popen(["rtk", "proxy", str(PYTHON), str(runner or REPO / "experiments/buzz-autonomy/worker.py"), job], stdout=output, stderr=output, start_new_session=True)
        try:
            started = time.monotonic()
            while process.poll() is None:
                with database() as db:
                    state = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
                reason = ("cancelled" if state and state["status"] == "cancelled"
                          else "paused" if (ROOT / "PAUSED").exists()
                          else "timeout" if timeout is not None and
                          time.monotonic() - started > timeout else None)
                if reason:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL); process.wait()
                    with database() as db:
                        db.execute("UPDATE jobs SET status=?,result=? WHERE id=?", ("cancelled" if reason == "cancelled" else "failed", reason, job))
                    event(job, "supervisor", "stopped", {"reason": reason})
                    return False
                time.sleep(.25)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                with database() as db:
                    db.execute("UPDATE jobs SET status='failed',result='Supervisor interrupted' WHERE id=? AND status IN ('queued','running')", (job,))
                event(job, "supervisor", "stopped", {"reason": "supervisor_interrupted"})
    return process.returncode == 0


def tick(limit, parent=None):
    if not 1 <= limit <= 20:
        raise ValueError("A tick budget is 1..20 conversations")
    recover_stale_pi_leases()
    completed = []
    for _ in range(limit):
        if (ROOT / "PAUSED").exists():
            break
        with database() as db:
            row = db.execute("""SELECT j.id FROM jobs j WHERE j.status='queued' AND j.attempts<3
                AND NOT EXISTS (SELECT 1 FROM job_dependencies d LEFT JOIN jobs p ON p.id=d.prerequisite
                    WHERE d.job=j.id AND (p.status IS NULL OR p.status!='done'))
                AND NOT EXISTS (SELECT 1 FROM jobs p WHERE p.id=j.parent AND p.status!='done')
                AND NOT EXISTS (SELECT 1 FROM inbound p WHERE p.job=j.parent AND p.status!='done')
                AND (? IS NULL OR j.parent=?)
                ORDER BY j.created LIMIT 1""", (parent, parent)).fetchone()
        if not row:
            break
        execute(row["id"])
        completed.append(row["id"])
    event("tick", "supervisor", "budget", {"limit": limit, "parent": parent, "executed": completed})
    return completed


def retry(job):
    with database() as db:
        changed = db.execute("UPDATE jobs SET status='queued',started=NULL WHERE id=? AND status='failed' AND attempts<3", (job,)).rowcount
    return bool(changed)


def cancel(job, reason=None):
    """Stop a job, saying why.

    A cancelled row with an empty `result` is indistinguishable from one the
    operator abandoned: whoever reads the record later cannot tell whether the
    work was superseded, wrong, or simply forgotten. The reason is the whole
    difference between a decision and a gap.
    """
    with database() as db:
        stopped = bool(db.execute(
            "UPDATE jobs SET status='cancelled', result=COALESCE(?,result) "
            "WHERE id=? AND status IN ('queued','running')", (reason, job)).rowcount)
    if stopped and reason:
        event(job, "control-plane", "cancelled", {"reason": reason})
    return stopped


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--delay", type=float, default=0)
    parser.add_argument("--schedule-id")
    args = parser.parse_args()
    if not 0 <= args.delay <= 60:
        raise ValueError("Pilot scheduling delay must be 0..60 seconds")
    if args.schedule_id:
        event(args.schedule_id, "supervisor", "timer_scheduled", {"delay": args.delay, "due_at": time.time() + args.delay})
        time.sleep(args.delay)
        enqueue("maestro", "Recall the project notebook. Identify one useful unanswered question from actual evidence, save it with provenance, and write scheduled-learning.md explaining the smallest next learning experiment. Do not claim new external research.", args.schedule_id)
        event(args.schedule_id, "supervisor", "timer_fired", {"delay": args.delay})
    print(json.dumps({"executed": tick(args.limit)}))
