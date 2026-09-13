"""Say which work is stuck, and why, from the record rather than from opinion.

This exists so the maestro can exercise resilience itself instead of a Python
driver doing it behind its back. The split is deliberate:

* **The diagnosis is computed.** Whether a job is stalled, blocked or
  unproductive is a fact about the event log — elapsed time, repeated identical
  tool failures, an artifact that does or does not exist. A model asked to
  eyeball this would guess, and a wrong guess sends a teammate up the wrong
  ladder.
* **The remedy is the maestro's.** Nothing here decides what to do. It reports
  the obstacle and leaves the choice — narrow the scope, hand it to someone with
  different access, drop it, escalate — where the judgement belongs.

The four verdicts that are not "done" each name a different failure of the same
project, and they are not interchangeable:

    stalled       running, but nothing has happened for a while
    blocked       hitting the same wall over and over; more budget will not help
    unproductive  it finished, but produced no deliverable
    failed        it stopped, and the reason is recorded
"""
import json
import time

from pilot import database

# A turn that has logged nothing for this long is not thinking, it is stuck.
# Generous enough that a long model call or a slow fetch is not misread as a
# stall — a research turn legitimately ran twenty minutes.
STALL_SECONDS = 420
# Matches the capability breaker: the same failure this many times is a wall,
# not bad luck.
BLOCKED_REPEATS = 3


def _expected(project: str) -> dict[str, dict]:
    """The assignments this project is supposed to contain.

    Without this, a role that never reached the jobs table simply does not
    appear in the portfolio — and an absent row reads as "nothing to worry
    about", which is the most expensive kind of silence.
    """
    if project != "tower":
        return {}
    try:
        from control_plane.tower_project import ASSIGNMENTS

        return ASSIGNMENTS
    except Exception:  # noqa: BLE001 - a missing project definition is not fatal
        return {}


def _rows(project: str) -> list[dict]:
    like = f"{project}%"
    with database() as db:
        jobs = [dict(r) for r in db.execute(
            "SELECT id, role, status, attempts, result, created, started "
            "FROM jobs WHERE id LIKE ? ORDER BY created", (like,))]
        events = [dict(r) for r in db.execute(
            "SELECT job, action, data, at FROM events WHERE job LIKE ? ORDER BY seq",
            (like,))]
    by_job: dict[str, list[dict]] = {}
    for entry in events:
        by_job.setdefault(entry["job"], []).append(entry)
    for job in jobs:
        job["events"] = by_job.get(job["id"], [])
    return jobs


def _obstacle(job: dict, now: float) -> tuple[str, str]:
    """Return (verdict, evidence). Order matters: the wall outranks its symptom."""
    walls: dict[str, int] = {}
    reason, produced, last = None, False, job.get("started") or job.get("created") or now

    for entry in job["events"]:
        last = max(last, entry.get("at") or 0)
        try:
            payload = json.loads(entry["data"])
        except (TypeError, ValueError):
            payload = {}
        if entry["action"] == "tool_error" and payload.get("repeat", 0) >= BLOCKED_REPEATS:
            signature = f'{payload.get("action")}: {payload.get("message", "")[:120]}'
            walls[signature] = max(walls.get(signature, 0), payload["repeat"])
        if entry["action"] in ("incomplete", "stopped"):
            reason = payload.get("reason")
        if entry["action"] in ("report_saved", "buzz_report"):
            produced = True

    if walls:
        worst = max(walls.items(), key=lambda kv: kv[1])
        return "blocked", f"{worst[1]}x — {worst[0]}"
    if job["status"] == "running":
        idle = now - last
        if idle > STALL_SECONDS:
            return "stalled", f"sin actividad desde hace {int(idle // 60)} min"
        return "running", f"activo hace {int(idle)}s"
    if job["status"] == "done":
        # A job that reports success without leaving anything behind has not
        # done the work; treating it as done is how a hole reaches the operator.
        return ("done", "entregado") if produced else ("unproductive", "cerró sin entregable")
    if job["status"] in ("failed", "cancelled"):
        return "failed", reason or job.get("result") or "sin causa registrada"
    return job["status"] or "queued", "en cola"


def portfolio(project: str = "tower") -> dict:
    """Every job in a project, with a verdict and the evidence behind it."""
    now = time.time()
    jobs = []
    for job in _rows(project):
        verdict, evidence = _obstacle(job, now)
        jobs.append({
            "job": job["id"], "role": job["role"], "verdict": verdict,
            "evidence": evidence, "attempts": job["attempts"],
            "minutes": int((now - (job.get("created") or now)) // 60),
        })
    # Roles that run on the other harness leave no row in the jobs table. Left
    # implicit they simply vanish from the portfolio, which reads as "nothing to
    # worry about" — the most expensive kind of silence. Name them as unseen.
    seen = {job["role"] for job in jobs}
    for role, assignment in _expected(project).items():
        if assignment["identity"] not in seen:
            jobs.append({
                "job": f"{project}-{role}", "role": assignment["identity"],
                "verdict": "sin registro", "attempts": 0, "minutes": 0,
                "evidence": "corre en el otro harness; no deja traza en la cola",
            })

    counts: dict[str, int] = {}
    for job in jobs:
        counts[job["verdict"]] = counts.get(job["verdict"], 0) + 1
    needs_attention = [j for j in jobs
                       if j["verdict"] in ("blocked", "stalled", "unproductive", "failed")]
    return {
        "project": project,
        "jobs": jobs,
        "counts": counts,
        "needs_attention": needs_attention,
        "healthy": not needs_attention,
    }
