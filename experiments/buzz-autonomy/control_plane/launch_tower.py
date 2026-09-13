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
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from control_plane.tower_project import CHANNEL as _CHANNEL

# Results belong in the project's channel, not among the daily briefings. Set
# before `reporting` is imported anywhere, so no report can slip out first.
os.environ.setdefault("BUZZ_PUBLISH_CHANNEL", _CHANNEL)

from pilot import config, database, enqueue
from control_plane.roster import CONTRACTS, PI
from control_plane.tower_project import ASSIGNMENTS, CHANNEL, ORDER, brief_for

JOB_PREFIX = "tower"


def job_id(role: str) -> str:
    return f"{JOB_PREFIX}-{role}"


def status_of(job: str) -> str | None:
    with database() as db:
        row = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
    return row["status"] if row else None


def dispatch_hermes(role: str, dry_run: bool) -> str:
    job = job_id(role)
    existing = status_of(job)
    if existing == "done":
        return "ya hecho"
    depends = [job_id(d) for d in ASSIGNMENTS[role]["depends_on"]]
    if dry_run:
        return f"encolaría (depende de {depends or 'nada'})"
    enqueue(CONTRACTS[role]["identity"], brief_for(role), job, depends_on=depends)
    import worker

    worker.run(job)
    return "hecho"


def dispatch_pi(role: str, dry_run: bool) -> str:
    if dry_run:
        return "ejecutaría en pi (solo lectura)"
    from control_plane import pi_harness, telemetry

    repo = str(Path(__file__).resolve().parents[3])
    record = pi_harness.run(role, brief_for(role), repo, timeout=1800)
    telemetry.flush()
    out = Path.home() / ".local/share/buzz-autonomy-pilot/sapira/artifacts/tower"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{role}.md").write_text(record["final"], encoding="utf-8")
    (out / f"{role}.json").write_text(json.dumps(
        {k: v for k, v in record.items() if k != "final"}, indent=2), encoding="utf-8")
    return f"hecho (trace {record.get('trace_id')})"


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
        try:
            result = (dispatch_pi if harness == PI else dispatch_hermes)(role, dry_run)
        except Exception as error:  # noqa: BLE001 - one failure must not stop the rest
            print(f"  {role:12} {harness:7} FALLÓ: {type(error).__name__}: {error}"[:200])
            continue
        print(f"  {role:12} {harness:7} {result} ({time.time() - started:.0f}s)")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="show what would be dispatched, touch nothing")
    parser.add_argument("--only", help="dispatch a single role")
    args = parser.parse_args()
    raise SystemExit(main(args.dry_run, args.only))
