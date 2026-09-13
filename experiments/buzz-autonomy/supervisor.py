"""Bounded local queue runner; no permanent cron, deployment or background service."""
import argparse
import json
import os
import signal
import subprocess
import time

from pilot import ROOT, REPO, PYTHON, database, enqueue, event


def execute(job, timeout=180, runner=None):
    logs = ROOT / "logs"; logs.mkdir(parents=True, exist_ok=True)
    with (logs / (job + ".log")).open("a") as output:
        process = subprocess.Popen(["rtk", "proxy", str(PYTHON), str(runner or REPO / "experiments/buzz-autonomy/worker.py"), job], stdout=output, stderr=output, start_new_session=True)
        try:
            started = time.monotonic()
            while process.poll() is None:
                with database() as db:
                    state = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
                reason = "cancelled" if state and state["status"] == "cancelled" else "paused" if (ROOT / "PAUSED").exists() else "timeout" if time.monotonic() - started > timeout else None
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


def cancel(job):
    with database() as db:
        return bool(db.execute("UPDATE jobs SET status='cancelled' WHERE id=? AND status IN ('queued','running')", (job,)).rowcount)


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
