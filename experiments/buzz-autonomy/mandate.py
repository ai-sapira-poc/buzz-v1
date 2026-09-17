"""Drain one completed native mandate and return its evidence to the maestro.

One durable driver, one file lock, at most fourteen specialist conversations and
one synthesis. It never consumes the global queue or automatically retries
failures; a long-running specialist may keep this driver alive until it finishes
or is explicitly cancelled.
"""
import argparse
import fcntl
import hashlib
import json
import subprocess
import signal

from pilot import ROOT, REPO, PYTHON, database, enqueue, event
from supervisor import tick, execute


def synthesis_id(parent):
    return "synthesis-" + hashlib.sha256(parent.encode()).hexdigest()[:40]


def launch(parent):
    """Launch a durable driver after the native turn has durably completed."""
    logs = ROOT / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / (synthesis_id(parent) + "-driver.log")).open("a") as output:
        process = subprocess.Popen(
            ["rtk", "proxy", str(PYTHON), str(REPO / "experiments/buzz-autonomy/mandate.py"), parent],
            stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
    event(parent, "supervisor", "driver_launched", {"pid": process.pid})


def drive(parent):
    locks = ROOT / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    summary = synthesis_id(parent)
    with (locks / (summary + ".lock")).open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "already_running"}
        with database() as db:
            source = db.execute("SELECT status FROM inbound WHERE job=? AND role='maestro'", (parent,)).fetchall()
            if not source or any(row["status"] != "done" for row in source):
                raise ValueError("Only a completed native maestro mandate can drive work")
            children = db.execute("SELECT id FROM jobs WHERE parent=?", (parent,)).fetchall()
        if not children:
            return {"status": "no_delegation"}
        if (ROOT / "PAUSED").exists():
            return {"status": "paused"}
        tick(14, parent=parent)
        with database() as db:
            rows = [dict(row) for row in db.execute(
                "SELECT id,role,status FROM jobs WHERE parent=? ORDER BY created", (parent,))]
        from operator_updates import publish_update, summarize_children

        children_summary = summarize_children(rows)
        summary_key = "children-" + hashlib.sha256(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()[:16]
        publish_update("maestro", "maestro", parent, "summary", count=children_summary,
                       key=summary_key)
        if any(row["status"] != "done" for row in rows):
            event(parent, "supervisor", "mandate_incomplete", {"children": rows})
            return {"status": "incomplete", "children": rows}
        # Synthesis is a separate task, outside the specialist queue. The capability
        # boundary denies delegation from synthesis tasks, preventing recursive work.
        enqueue("maestro", "Synthesize this completed mandate from the dependency handoff. "
                "Read the specialist and independent review evidence. State disagreements, "
                "verified outcomes and remaining limitations; do not convert proposals into "
                "executed tests. Write a concise English business report to reports/" + summary + ".md. "
                "This is the final synthesis: delegation is disabled.",
                summary, depends_on=[row["id"] for row in rows])
        with database() as db:
            state = db.execute("SELECT status FROM jobs WHERE id=?", (summary,)).fetchone()["status"]
        if state == "queued" and not (ROOT / "PAUSED").exists():
            execute(summary)
        with database() as db:
            state = db.execute("SELECT status FROM jobs WHERE id=?", (summary,)).fetchone()["status"]
        event(parent, "supervisor", "mandate_synthesis", {"job": summary, "status": state})
        return {"status": state, "synthesis": summary}


if __name__ == "__main__":
    def stop(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, stop)
    args = argparse.ArgumentParser()
    args.add_argument("parent")
    print(drive(args.parse_args().parent))
