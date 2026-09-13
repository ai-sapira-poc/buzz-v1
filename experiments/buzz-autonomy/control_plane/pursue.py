"""Drive one assignment to its goal, changing approach when an approach fails.

The launcher this replaces executed a list. Today's run showed what that costs:
`tower-diseno` died on `max_iterations_reached(16/16)` and `tower-arquitecto` on
a pi timeout, and the project simply stopped with both holes in it. Nothing
retried, nothing tried a different route, and nothing said the goal was
unreached — the launcher reported eight assignments and moved on.

The rule here is that **a failure is a fact about the approach, not about the
goal**. So each failure is classified and answered with a *different* approach,
never the same one again:

    budget exhausted   → split the work; each part gets a full budget
    timeout            → same, plus a longer window
    blocked path       → hand it to a teammate whose access differs
    empty answer       → restate the assignment more concretely
    denied capability  → stop and escalate; no ladder rung fixes a permission

The ladder is finite and every rung is recorded, so "we could not do this" is
always accompanied by what was tried. An agent that gives up loudly is worth far
more than one that fails quietly, and both are worth more than one that retries
the same thing until the money runs out.

    python control_plane/pursue.py diseno
    python control_plane/pursue.py diseno --max-attempts 2 --dry-run
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from pilot import ROOT, database, event
from control_plane.roster import CONTRACTS, PI
from control_plane.tower_project import ASSIGNMENTS, CHANNEL, brief_for

# Ordered widest-to-narrowest: the first rung that matches the failure wins.
# Keep `denied` first — a permission failure must never be answered by retrying
# with a bigger budget, which would just spend more money on the same refusal.
LADDER = ("denied", "blocked", "budget", "timeout", "empty")


def classify(outcome: dict) -> str:
    """Name the obstacle from the evidence, not from the exception type alone."""
    reason = str(outcome.get("reason") or "")
    if outcome.get("denied"):
        return "denied"
    if outcome.get("blocked_calls"):
        return "blocked"
    if "max_iterations" in reason or "budget" in reason:
        return "budget"
    # Match the supervisor's bare "timeout" as well as pi's "TimeoutExpired":
    # the narrower check classified a killed job as unknown.
    if "timeout" in reason.lower() or "timed out" in reason.lower():
        return "timeout"
    if outcome.get("status") == "done" and not outcome.get("final"):
        return "empty"
    return "unknown"


def approach(role: str, obstacle: str, attempt: int, brief: str) -> dict:
    """The next thing to try, given what just stopped us.

    Returns the parameters of a genuinely different attempt. Returning the same
    brief with one more retry would reproduce the failure we are answering.
    """
    if obstacle == "denied":
        return {}  # no rung fixes a permission; escalate instead

    if obstacle in ("budget", "timeout"):
        return {
            "brief": (
                brief
                + "\n\n--- AJUSTE DEL ENCARGO (intento "
                + str(attempt)
                + ") ---\n"
                "El intento anterior agotó su presupuesto sin cerrar. No repitas el "
                "mismo plan. Entrega SOLO la primera pieza indivisible de este "
                "encargo, completa y verificable, y enumera explícitamente lo que "
                "dejas fuera para un encargo posterior. Una pieza cerrada vale más "
                "que un plan entero a medias."
            ),
            "budget": 24 if obstacle == "budget" else 16,
            "window": 1800 if obstacle == "timeout" else 900,
        }

    if obstacle == "blocked":
        return {
            "brief": (
                brief
                + "\n\n--- AJUSTE DEL ENCARGO (intento "
                + str(attempt)
                + ") ---\n"
                "Una vía quedó cerrada en el intento anterior y sigue cerrada. No "
                "la reintentes. Resuelve el encargo por otro camino, y si no existe "
                "otro camino, entrega el análisis sin el artefacto y di con precisión "
                "qué obstáculo te lo impide y quién podría levantarlo."
            ),
            "budget": 16,
            "window": 900,
        }

    if obstacle == "empty":
        return {
            "brief": (
                brief
                + "\n\n--- AJUSTE DEL ENCARGO (intento "
                + str(attempt)
                + ") ---\n"
                "El intento anterior no devolvió respuesta. Empieza por escribir la "
                "conclusión en tres líneas y solo después justifícala."
            ),
            "budget": 16,
            "window": 900,
        }

    # Unrecognised obstacle. Retrying the identical brief is the one thing we
    # know does not work, so the fallback still changes the approach: ask for
    # the obstacle to be named first, which also teaches us to classify it.
    return {
        "brief": (
            brief
            + "\n\n--- AJUSTE DEL ENCARGO (intento "
            + str(attempt)
            + ") ---\n"
            "El intento anterior terminó sin cerrar y sin una causa reconocible. "
            "Antes de trabajar, escribe en una línea qué te impidió terminar. "
            "Después entrega la parte del encargo que sí esté a tu alcance."
        ),
        "budget": 20,
        "window": 1200,
    }


def evidence_for(job: str) -> dict:
    """What actually happened, read from the event log rather than assumed."""
    with database() as db:
        rows = db.execute(
            "SELECT action, data FROM events WHERE job=? ORDER BY seq", (job,)
        ).fetchall()
        status = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()

    blocked, denied, reason, final = 0, False, None, ""
    for action, data in rows:
        try:
            payload = json.loads(data)
        except (TypeError, ValueError):
            continue
        if action == "tool_error" and payload.get("repeat", 0) >= 3:
            blocked += 1
        if action == "denied":
            denied = True
        if action in ("incomplete", "stopped"):
            # `stopped` carries the supervisor's own reason (timeout, cancelled).
            # Reading only `incomplete` classified a killed job as "unknown" and
            # sent it up the wrong rung of the ladder.
            reason = payload.get("reason")
        if action == "report_saved":
            final = payload.get("final_response", "")
    return {"status": status[0] if status else None, "reason": reason,
            "blocked_calls": blocked, "denied": denied, "final": final}


def attempt_once(role: str, job: str, brief: str, budget: int, window: int) -> dict:
    """Run one attempt on whichever harness this role belongs to."""
    import os

    contract = CONTRACTS[role]
    if contract["harness"] == PI:
        from control_plane.pi_harness import run as run_pi

        result = run_pi(role, brief, str(ROOT), timeout=window)
        return {"status": "done" if result.get("final") else "failed", **result}

    previous = os.environ.get("BUZZ_TURN_BUDGET")
    os.environ["BUZZ_TURN_BUDGET"] = str(budget)
    try:
        from pilot import enqueue
        import supervisor

        enqueue(contract["identity"], brief, job)
        # `tick` runs whatever is queued under a fixed 180s deadline, which
        # silently overrode the window this rung asked for: attempt 2 was given
        # 900s and was killed at 180. Drive the job we know about, directly.
        supervisor.execute(job, timeout=window)
    finally:
        if previous is None:
            os.environ.pop("BUZZ_TURN_BUDGET", None)
        else:
            os.environ["BUZZ_TURN_BUDGET"] = previous
    return evidence_for(job)


def pursue(role: str, max_attempts: int = 3, dry_run: bool = False) -> dict:
    """Keep trying to reach this assignment's goal, by different routes."""
    brief = brief_for(role)
    tried: list[dict] = []
    obstacle = None
    first = 1

    # A project that already ran leaves its result behind. Re-running a finished
    # assignment wastes money; re-running a failed one *identically* reproduces
    # the failure. So the prior outcome becomes attempt 1, and the ladder picks
    # up from the obstacle it actually hit.
    if not dry_run:
        previous = evidence_for(f"tower-{role}")
        if previous["status"] == "done" and previous["final"]:
            return {"role": role, "reached": True, "attempts": [
                {"attempt": 1, "job": f"tower-{role}", "status": "done",
                 "obstacle": None, "resumed": True}]}
        if previous["status"]:
            obstacle = classify(previous)
            tried.append({"attempt": 1, "job": f"tower-{role}",
                          "status": previous["status"], "obstacle": obstacle,
                          "resumed": True})
            first = 2
            print(f"  intento 1: {previous['status']} ({obstacle}) "
                  "— recuperado del intento anterior", flush=True)

    for attempt in range(first, max_attempts + 1):
        job = f"tower-{role}" if attempt == 1 else f"tower-{role}-r{attempt}"
        plan = ({"brief": brief, "budget": 16, "window": 900} if attempt == 1
                else approach(role, obstacle, attempt, brief))
        if not plan:
            tried.append({"attempt": attempt, "skipped": "sin vía alternativa",
                          "obstacle": obstacle})
            break

        if dry_run:
            print(f"  intento {attempt}: obstáculo={obstacle or '—'} "
                  f"budget={plan['budget']} window={plan['window']}s")
            tried.append({"attempt": attempt, "obstacle": obstacle, "dry_run": True})
            obstacle = "budget"  # exercise the ladder without spending money
            continue

        started = time.time()
        outcome = attempt_once(role, job, plan["brief"], plan["budget"], plan["window"])
        obstacle = classify(outcome)
        record = {"attempt": attempt, "job": job, "status": outcome.get("status"),
                  "obstacle": obstacle, "seconds": round(time.time() - started)}
        tried.append(record)
        event(job, role, "pursuit_attempt", record)
        print(f"  intento {attempt}: {record['status']} "
              f"({obstacle}) en {record['seconds']}s", flush=True)

        if outcome.get("status") == "done" and obstacle != "empty":
            return {"role": role, "reached": True, "attempts": tried}

    # Reaching here is a real outcome, not an error to hide: the goal was not
    # met, and the record of what was tried is what lets a teammate or the
    # operator pick it up without repeating the dead ends.
    result = {"role": role, "reached": False, "attempts": tried,
              "obstacle": obstacle}
    event(f"tower-{role}", role, "pursuit_exhausted", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=sorted(ASSIGNMENTS))
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"objetivo: {args.role}  canal: {CHANNEL}")
    outcome = pursue(args.role, args.max_attempts, args.dry_run)
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    raise SystemExit(0 if outcome["reached"] or args.dry_run else 1)
