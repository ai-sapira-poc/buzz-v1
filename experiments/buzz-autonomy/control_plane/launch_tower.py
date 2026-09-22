"""Launch the Tower Control project: dispatch each brief to its harness, in order.

Dependencies are respected, so `arquitecto` never starts before `producto` has
produced the problem statement it is supposed to build on. Roles with no
dependencies run first and their results become handoff input for the rest.

Run with the Hermes interpreter — it is the one that has both the agent runtime
and the OpenTelemetry SDK:

    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \\
      ~/.hermes/hermes-agent/venv/bin/python control_plane/launch_tower.py --dry-run

Drop `--dry-run` to actually dispatch. Every step is idempotent: an assignment
already done is skipped, so a crashed launch resumes instead of duplicating work.
"""
import argparse
from contextlib import contextmanager
import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from control_plane.tower_project import CHANNEL as _CHANNEL

# Results belong in the project's channel, not among the daily briefings. Set
# before `reporting` is imported anywhere, so no report can slip out first.
os.environ.setdefault("BUZZ_PUBLISH_CHANNEL", _CHANNEL)

from pilot import config, database, enqueue, event
from control_plane.roster import CONTRACTS, PI
from control_plane.tower_project import ASSIGNMENTS, CHANNEL, ORDER, brief_for

JOB_PREFIX = "tower"
PI_TIMEOUT = (int(os.environ["BUZZ_PI_TIMEOUT"])
              if os.environ.get("BUZZ_PI_TIMEOUT") else None)


def _seconds(name: str, default: int) -> int:
    raw = os.environ.get(name)
    value = default if raw is None else int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


HEARTBEAT_INTERVAL = _seconds("BUZZ_HEARTBEAT_INTERVAL", 30)
OPERATOR_HEARTBEAT_INTERVAL = _seconds("BUZZ_OPERATOR_HEARTBEAT_INTERVAL", 300)
LEASE_TTL = _seconds(
    "BUZZ_JOB_LEASE_TTL",
    int(os.environ.get("BUZZ_PI_STALE_GRACE", "120")),
)
if LEASE_TTL <= HEARTBEAT_INTERVAL:
    raise ValueError("BUZZ_JOB_LEASE_TTL must be greater than BUZZ_HEARTBEAT_INTERVAL")
ARTIFACTS = Path.home() / ".local/share/buzz-autonomy-pilot/sapira/artifacts/tower"


def job_id(role: str) -> str:
    return f"{JOB_PREFIX}-{role}"


def status_of(job: str) -> str | None:
    with database() as db:
        row = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
    return row["status"] if row else None


def _prepare_job(role: str) -> bool:
    """Ensure the canonical assignment is queued, preserving its history.

    Hermes used to requeue only through the pursuit driver, while the Tower
    launcher treated a failed row as if it were new. Pi had no row at all. The
    launcher is the owner of this project-level idempotency boundary, so both
    harnesses pass through it now.
    """
    job = job_id(role)
    identity = CONTRACTS[role]["identity"]
    depends = [job_id(dependency) for dependency in ASSIGNMENTS[role]["depends_on"]]
    enqueue(identity, brief_for(role), job, depends_on=depends)
    stale = False
    with database() as db:
        row = db.execute("SELECT status,started FROM jobs WHERE id=?", (job,)).fetchone()
        if row["status"] == "done":
            return False
        if row["status"] == "cancelled":
            # Cancellation is an operator decision, not a transient failure
            # for the launcher to undo on its next invocation. `retry` or a new
            # assignment must explicitly put the job back in the queue.
            return False
        if row["status"] == "running":
            heartbeat = db.execute(
                "SELECT max(at) FROM events WHERE job=? AND action='assignment_heartbeat'",
                (job,),
            ).fetchone()[0]
            last_seen = max(row["started"] or 0, heartbeat or 0)
            age = time.time() - last_seen
            if age <= LEASE_TTL:
                raise RuntimeError(f"job {job} is already running")
            stale = True
            db.execute(
                "UPDATE jobs SET status='failed',result=? WHERE id=? AND status='running'",
                (f"stale running job recovered after {age:.0f}s", job),
            )
        if row["status"] != "queued":
            db.execute("UPDATE jobs SET status='queued' WHERE id=?", (job,))
    if stale:
        event(job, role, "stale_recovered", {"lease_ttl_seconds": LEASE_TTL})
    return True


def _claim_pi(role: str) -> int:
    """Claim a queued Pi job and return its one-based attempt number."""
    job = job_id(role)
    with database() as db:
        pending = db.execute(
            """SELECT d.prerequisite FROM job_dependencies d
               LEFT JOIN jobs p ON p.id=d.prerequisite
               WHERE d.job=? AND (p.status IS NULL OR p.status!='done') LIMIT 1""",
            (job,),
        ).fetchone()
        if pending:
            raise RuntimeError(f"prerequisite {pending['prerequisite']} is not done")
        row = db.execute("SELECT status,attempts FROM jobs WHERE id=?", (job,)).fetchone()
        if not row or row["status"] != "queued":
            raise RuntimeError(f"job {job} is not queued")
        attempt = row["attempts"] + 1
        db.execute(
            "UPDATE jobs SET status='running',started=?,attempts=? WHERE id=?",
            (time.time(), attempt, job),
        )
    return attempt


def _finish(job: str, status: str, result: str) -> None:
    """Persist a terminal state without overwriting a newer generation."""
    with database() as db:
        changed = db.execute(
            "UPDATE jobs SET status=?,result=? WHERE id=? AND status='running'",
            (status, result[:12000], job),
        ).rowcount
    if changed != 1:
        raise RuntimeError(f"job {job} changed state before it could be closed")


def _fail(job: str, error: Exception) -> None:
    """Leave a retryable durable result for a failed launcher attempt."""
    with database() as db:
        db.execute(
            "UPDATE jobs SET status='failed',result=? WHERE id=? AND status IN ('queued','running')",
            (f"{type(error).__name__}: {error}"[:12000], job),
        )


def _cancel(job: str, reason: str) -> None:
    """Persist cancellation without turning it into a retryable failure."""
    with database() as db:
        db.execute(
            "UPDATE jobs SET status='cancelled',result=? WHERE id=? "
            "AND status IN ('queued','running')",
            (reason[:12000], job),
        )


def _published_handoff(job: str) -> tuple[str, dict] | None:
    """Recover a handoff that reached Buzz before local finalization failed."""
    with database() as db:
        rows = db.execute(
            "SELECT data FROM events WHERE job=? AND action='handoff_published' "
            "ORDER BY seq DESC", (job,)
        ).fetchall()
    base = ARTIFACTS.resolve()
    for row in rows:
        try:
            payload = json.loads(row[0])
            artifact = Path(payload["artifact"]).resolve()
            artifact.relative_to(base)
            final = artifact.read_text(encoding="utf-8")
        except (KeyError, TypeError, ValueError, OSError):
            continue
        if final.strip():
            return final, payload
    return None


def _publish_lifecycle(role: str, job: str, state: str,
                       publisher: str | None = None, **data) -> None:
    """Record and best-effort publish a small operator-visible state update.

    The local event is authoritative for retry/diagnosis. The Buzz message is
    the human-facing projection; failure to project it is recorded explicitly
    and never turns work into a false success. Actual Pi handoffs use the
    stricter `publish` call in `dispatch_pi` below.
    """
    payload = {"state": state, **data}
    event(job, role, f"assignment_{state}", payload)
    signer = publisher or CONTRACTS[role]["identity"]
    try:
        from operator_updates import publish_update

        receipt = publish_update(
            signer,
            role,
            job,
            state,
            missing=data.get("missing"),
            detail=data.get("error"),
            key=f"lifecycle-{state}-{data.get('attempt', '')}",
        )
        event(job, role, "lifecycle_published", {
            "state": state,
            "event_id": receipt.get("event_id") if isinstance(receipt, dict) else None,
        })
    except Exception as error:  # noqa: BLE001 - preserve work, expose lost projection
        event(job, role, "lifecycle_publish_failed", {
            "state": state, "error": f"{type(error).__name__}: {error}"[:500],
        })


@contextmanager
def _heartbeats(role: str, job: str, trace_id: str | None = None):
    """Write local heartbeats and sample long work into the community."""
    stopped = threading.Event()
    started = time.monotonic()
    beat = 0
    next_operator_signal = OPERATOR_HEARTBEAT_INTERVAL

    def emit() -> None:
        nonlocal beat, next_operator_signal
        while not stopped.wait(HEARTBEAT_INTERVAL):
            beat += 1
            elapsed = int(time.monotonic() - started)
            event(job, role, "assignment_heartbeat", {
                "trace_id": trace_id, "interval_seconds": HEARTBEAT_INTERVAL,
                "elapsed_seconds": elapsed, "beat": beat,
            })
            if elapsed >= next_operator_signal:
                from operator_updates import publish_update

                publish_update(
                    CONTRACTS[role]["identity"], role, job, "running",
                    detail=f"latido {beat}; {elapsed}s desde el inicio",
                    key=f"lifecycle-running-{beat}",
                )
                next_operator_signal += OPERATOR_HEARTBEAT_INTERVAL

    thread = threading.Thread(target=emit, name=f"tower-heartbeat-{role}", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join(timeout=2)


def _cancel_requested(job: str, cancel_path: Path | None = None) -> bool:
    """Read both durable operator state and the local emergency cancel marker."""
    return status_of(job) == "cancelled" or bool(cancel_path and cancel_path.exists())


def _dependency_gaps(role: str) -> list[str]:
    gaps = []
    with database() as db:
        for dependency in ASSIGNMENTS[role]["depends_on"]:
            row = db.execute(
                "SELECT status FROM jobs WHERE id=?", (job_id(dependency),)
            ).fetchone()
            if not row or row["status"] != "done":
                gaps.append(dependency)
    return gaps


def dispatch_hermes(role: str, dry_run: bool) -> str:
    job = job_id(role)
    if dry_run:
        depends = [job_id(d) for d in ASSIGNMENTS[role]["depends_on"]]
        return f"encolaría (depende de {depends or 'nada'})"
    if not _prepare_job(role):
        return "ya hecho"
    with database() as db:
        row = db.execute("SELECT attempts FROM jobs WHERE id=?", (job,)).fetchone()
    attempt = row["attempts"] + 1
    _publish_lifecycle(role, job, "started", attempt=attempt)
    import worker

    try:
        with _heartbeats(role, job):
            worker.run(job)
    except Exception as error:
        cancelled = status_of(job) == "cancelled"
        if not cancelled:
            _fail(job, error)
        _publish_lifecycle(role, job, "cancelled" if cancelled else "failed",
                           attempt=attempt, error=str(error))
        raise
    if status_of(job) == "cancelled":
        _publish_lifecycle(role, job, "cancelled", attempt=attempt)
        return "cancelado"
    _publish_lifecycle(role, job, "done", attempt=attempt)
    return "hecho"


def dispatch_pi(role: str, dry_run: bool) -> str:
    if dry_run:
        return "ejecutaría en pi (solo lectura)"
    from control_plane import pi_harness, telemetry
    from reporting import publish

    repo = str(Path(__file__).resolve().parents[3])
    job = job_id(role)
    if not _prepare_job(role):
        return "ya hecho"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    attempt = _claim_pi(role)
    trace_id = None
    checkpoint = ARTIFACTS / f"{job}.attempt-{attempt}.jsonl"
    cancel_path = ARTIFACTS / "cancel" / f"{job}.cancel"
    try:
        recovered = _published_handoff(job)
        if recovered:
            final, handoff = recovered
            event(job, role, "handoff_recovered", {
                "attempt": attempt, "source_event_id": handoff.get("event_id"),
                "artifact": handoff.get("artifact"),
            })
            _finish(job, "done", final)
            event(job, role, "assignment_finished", {
                "attempt": attempt, "recovered": True,
                "trace_id": handoff.get("trace_id"),
            })
            _publish_lifecycle(role, job, "done", attempt=attempt,
                               recovered=True, trace_id=handoff.get("trace_id"))
            # A crash between the prose publish and the edge publish leaves the
            # handoff recorded but unsurfaced. Recovery must not skip the
            # projection: re-emitting is safe, the reader folds by edge key.
            from operator_updates import publish_handoffs

            publish_handoffs(CONTRACTS[role]["identity"], role, job,
                             handoff.get("trace_id"))
            return "recuperado sin repetir el handoff"
        with telemetry.assignment(job, role) as span:
            trace_id = telemetry.trace_id_of(span)
            event(job, role, "trace_opened", {"trace_id": trace_id, "attempt": attempt})
            _publish_lifecycle(role, job, "started", attempt=attempt, trace_id=trace_id)
            with _heartbeats(role, job, trace_id):
                record = pi_harness.run(role, brief_for(role), repo, timeout=PI_TIMEOUT,
                                        job=job, checkpoint_path=checkpoint,
                                        cancel_path=cancel_path,
                                        cancel_check=lambda: status_of(job) == "cancelled")
            telemetry.flush()
        if _cancel_requested(job, cancel_path):
            raise RuntimeError("pi run cancelled before handoff publication")
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        artifact = ARTIFACTS / f"{job}.attempt-{attempt}.md"
        metadata = ARTIFACTS / f"{job}.attempt-{attempt}.json"
        artifact.write_text(record["final"], encoding="utf-8")
        # Keep a convenient latest view, while the event points at the
        # immutable attempt artifact so a later retry cannot overwrite what was
        # already published.
        (ARTIFACTS / f"{role}.md").write_text(record["final"], encoding="utf-8")
        metadata.write_text(json.dumps(
            {"job": job, "attempt": attempt,
             **{k: v for k, v in record.items() if k != "final"}},
            indent=2), encoding="utf-8")
        handoff = publish(CONTRACTS[role]["identity"], job, record["final"])
        event(job, role, "handoff_published", {
            "event_id": handoff.get("event_id") if isinstance(handoff, dict) else None,
            "trace_id": record.get("trace_id") or trace_id,
            "artifact": str(artifact),
        })
        # Project the fact that just landed locally onto the wire, one event
        # per child, so Tower can draw the edge. Best-effort: a relay failure is
        # recorded and never fails the delivery.
        from operator_updates import publish_handoffs

        publish_handoffs(CONTRACTS[role]["identity"], role, job,
                         record.get("trace_id") or trace_id)
        _finish(job, "done", record["final"])
        event(job, role, "assignment_finished", {
            "attempt": attempt, "trace_id": record.get("trace_id") or trace_id,
        })
        _publish_lifecycle(role, job, "done", attempt=attempt,
                           trace_id=record.get("trace_id") or trace_id)
        return f"hecho (trace {record.get('trace_id')})"
    except Exception as error:
        telemetry.flush()
        cancelled = _cancel_requested(job, cancel_path)
        if cancelled:
            _cancel(job, str(error))
        else:
            _fail(job, error)
        _publish_lifecycle(role, job, "cancelled" if cancelled else "failed", attempt=attempt,
                           trace_id=trace_id, error=str(error))
        raise


def main(dry_run: bool, only: str | None) -> int:
    c = config()
    print(f"relay   : {c['relay']}")
    print(f"canal   : {CHANNEL}")
    print(f"modelo  : {c['model']}")
    print(f"encargos: {len(ASSIGNMENTS)}\n")

    roles = [only] if only else ORDER
    for role in roles:
        if role not in ASSIGNMENTS:
            print(f"  {role}: no es un encargo de este proyecto")
            return 1
        harness = CONTRACTS[role]["harness"]
        started = time.time()
        if not dry_run:
            gaps = _dependency_gaps(role)
            if gaps:
                _publish_lifecycle(role, job_id(role), "blocked", publisher="maestro",
                                   missing=gaps)
                print(f"  {role:12} {harness:7} BLOQUEADO: depende de {', '.join(gaps)}",
                      flush=True)
                continue
        try:
            result = (dispatch_pi if harness == PI else dispatch_hermes)(role, dry_run)
        except Exception as error:  # noqa: BLE001 - one failure must not stop the rest
            print(f"  {role:12} {harness:7} FALLÓ: {type(error).__name__}: {error}"[:200],
                  flush=True)
            continue
        print(f"  {role:12} {harness:7} {result} ({time.time() - started:.0f}s)",
              flush=True)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="show what would be dispatched, touch nothing")
    parser.add_argument("--only", help="dispatch a single role")
    args = parser.parse_args()
    raise SystemExit(main(args.dry_run, args.only))
