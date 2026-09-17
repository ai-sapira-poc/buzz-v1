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
    timeout            → same approach change; no wall cap unless the operator
                         explicitly sets BUZZ_PILOT_HARD_TIMEOUT
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
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from pilot import REPO, ROOT, database, event
from control_plane.roster import CONTRACTS, PI, turn_budget
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


HARNESS_REJECTION = re.compile(
    # Every rejection class the traces show costing a turn without advancing
    # the work. Missing one makes the autopsy lie in the safe direction:
    # tower-diseno-c5ab328d scored 1/17 while six of its turns went to the
    # design-adapter refusal and the probes it wrote to decode it.
    r"Sapira CSS gate|foundation_block|mal formada|string indices must be integers"
    r"|Unknown Sapira token|supported design adapter|outside public research allowlist"
    r"|necesita \[|Replacement requires exactly one"
)


# Measured, not guessed: tower-diseno-c5ab328d spent 13.4 minutes on 17 turns
# and its retry 7.4 on 8 — about 47 s per turn on this model, which is slow by
# design and good because it iterates. A rung that buys turns without buying
# the wall clock to spend them just relabels the same death "timeout": 32 turns
# inside a 900 s window is a job that cannot finish.
SECONDS_PER_TURN = 75


def fits(budget: int, window: int) -> int:
    """The window a budget of this size actually needs."""
    return max(window, budget * SECONDS_PER_TURN)


def diagnose_budget(previous_job: str | None) -> dict:
    """Read the exhausted attempt's trace and say where the turns actually went.

    `diseno-tower-slice1-screen` (16/16) had its artifact through the gate by
    turn 8; six of the remaining turns were CSS-gate rejections and two were
    malformed calls. The budget rung answered by shrinking the *scope* — which
    is how `tower-diseno-min` ended up delivering a single row — when the scope
    was never the problem. A recovery that does not read the trace prescribes
    for the wrong disease.
    """
    if not previous_job:
        return {}
    path = ROOT / "runs" / (previous_job + ".json")
    if not path.exists():
        return {}
    try:
        messages = json.loads(path.read_text()).get("messages") or []
    except (OSError, ValueError):
        return {}
    model_turns = sum(1 for m in messages if m.get("role") == "assistant")
    harness_turns, validated = 0, []
    for m in messages:
        if m.get("role") != "tool":
            continue
        content = str(m.get("content") or "")
        if HARNESS_REJECTION.search(content):
            harness_turns += 1
        elif '"design_foundation"' in content:
            try:
                receipt = json.loads(content)
                validated.append(receipt.get("path"))
            except ValueError:
                pass
    return {"model_turns": model_turns, "harness_turns": harness_turns,
            # `_gate-probe.html` and friends are the agent testing the gate,
            # not deliverables; pointing the retry at them would mislead it.
            "validated": [p for p in dict.fromkeys(validated)
                          if p and not Path(p).name.startswith("_")]}


def approach(role: str, obstacle: str, attempt: int, brief: str,
             previous_job: str | None = None) -> dict:
    """The next thing to try, given what just stopped us.

    Returns the parameters of a genuinely different attempt. Returning the same
    brief with one more retry would reproduce the failure we are answering.
    """
    if obstacle == "denied":
        return {}  # no rung fixes a permission; escalate instead

    if obstacle == "budget":
        found = diagnose_budget(previous_job)
        turns, lost = found.get("model_turns", 0), found.get("harness_turns", 0)
        # When a third or more of the turns died on gate rejections or
        # malformed calls, the scope was fine and the dialect was the problem.
        # Shrinking the work would throw away what already passed.
        if turns and lost * 3 >= turns:
            resume = (
                "Ya pasaron el gate y siguen en disco: " + ", ".join(found["validated"])
                + ". Continúa desde ellos con write old_text/new_text; no los reescribas."
                if found.get("validated") else
                "Ningún artefacto pasó el gate; escribe el documento una sola vez."
            )
            return {
                "brief": (
                    brief
                    + "\n\n--- AJUSTE DEL ENCARGO (intento "
                    + str(attempt)
                    + ") ---\n"
                    f"El intento anterior perdió {lost} de {turns} turnos en rechazos "
                    "del gate de diseño o llamadas mal formadas, no en alcance. "
                    "MANTÉN el alcance completo del encargo. " + resume + " Lee el "
                    "dialecto del gate en tu instrucción antes de escribir CSS."
                ),
                "budget": 24,
                "window": 900,
                "diagnosis": found,
            }

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


def job_id(role: str, brief: str) -> str:
    """The job key for this role *and this wording of its assignment*.

    `enqueue` is idempotent on the key and refuses to reuse one with a different
    payload, so a rewritten brief cannot run under the original key. Deriving a
    suffix from the brief keeps both runs in the record — the old answer stays
    readable next to the question it actually answered — instead of silently
    overwriting one with the other.
    """
    base = f"tower-{role}"
    answered = answered_brief(base)
    if answered in (None, brief):
        return base
    digest = hashlib.sha256(brief.encode()).hexdigest()[:8]
    return f"{base}-{digest}"


def answered_brief(job: str) -> str | None:
    """The brief this job was actually run against, or None if it never ran.

    `enqueue` stores the prompt, which is the only record of what a finished
    answer was answering. Without this comparison a rewritten assignment
    resumes the old run and reports success: the goal changed, the answer did
    not, and nothing says so.
    """
    with database() as db:
        row = db.execute("SELECT prompt FROM jobs WHERE id=?", (job,)).fetchone()
    return row[0] if row else None


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


def hard_timeout() -> int | None:
    """Return an explicitly requested wall cap; slow quality work has none."""
    raw = os.environ.get("BUZZ_PILOT_HARD_TIMEOUT")
    if raw is None:
        return None
    value = int(raw)
    if value <= 0:
        raise ValueError("BUZZ_PILOT_HARD_TIMEOUT must be positive")
    return value


def attempt_once(role: str, job: str, brief: str, budget: int, window: int) -> dict:
    """Run one attempt on whichever harness this role belongs to."""
    contract = CONTRACTS[role]
    # `window` remains part of the ladder's evidence and dry-run output. It is
    # not a quality cap: only an explicit operator setting may kill a long run.
    window = hard_timeout()
    if contract["harness"] == PI:
        from control_plane.pi_harness import run as run_pi

        # The repository is the working directory, not the pilot home. A code
        # role started in ROOT cannot see `desktop/src` at all, so it would
        # "fail to find" files that are right there — a wrong answer that looks
        # like a finding.
        try:
            result = run_pi(role, brief, str(REPO), timeout=window, job=job)
        except Exception as error:  # noqa: BLE001
            # A driver whose job is surviving failure must survive this one. The
            # architect's timeout propagated straight out and killed the pursuit
            # on attempt 1, so the ladder it exists to climb was never reached.
            reason = f"{type(error).__name__}: {str(error)[:200]}"
            event(job, role, "attempt_crashed", {"reason": reason})
            return {"status": "failed", "reason": reason, "final": ""}
        return {"status": "done" if result.get("final") else "failed", **result}

    previous = os.environ.get("BUZZ_TURN_BUDGET")
    previous_channel = os.environ.get("BUZZ_PUBLISH_CHANNEL")
    os.environ["BUZZ_TURN_BUDGET"] = str(budget)
    # The report belongs in the project's channel. `reporting.target_channel`
    # falls back to the community default when this is unset, so every
    # dispatcher-driven report landed in `control-plane` while the whole team
    # was working in `tower-control` — the work was done and invisible where
    # anyone was looking for it.
    os.environ["BUZZ_PUBLISH_CHANNEL"] = CHANNEL
    try:
        from pilot import enqueue
        import supervisor

        enqueue(contract["identity"], brief, job)
        # `enqueue` is idempotent, so a rung that already ran and failed comes
        # back as the same failed row — and `execute` skips anything not queued,
        # returning in 0s without trying. The pursuit then "exhausted" its ladder
        # having attempted nothing. Put the rung back in the queue explicitly.
        with database() as db:
            db.execute(
                "UPDATE jobs SET status='queued', started=NULL, attempts=0 "
                "WHERE id=? AND status!='done'", (job,)
            )
        # `tick` runs whatever is queued under a fixed 180s deadline, which
        # silently overrode the window this rung asked for: attempt 2 was given
        # 900s and was killed at 180. Drive the job we know about, directly.
        supervisor.execute(job, timeout=window)
    finally:
        if previous is None:
            os.environ.pop("BUZZ_TURN_BUDGET", None)
        else:
            os.environ["BUZZ_TURN_BUDGET"] = previous
        if previous_channel is None:
            os.environ.pop("BUZZ_PUBLISH_CHANNEL", None)
        else:
            os.environ["BUZZ_PUBLISH_CHANNEL"] = previous_channel
    return evidence_for(job)


def pursue(role: str, max_attempts: int = 3, dry_run: bool = False) -> dict:
    """Keep trying to reach this assignment's goal, by different routes."""
    brief = brief_for(role)
    key = job_id(role, brief)
    tried: list[dict] = []
    obstacle = None
    first = 1

    # A project that already ran leaves its result behind. Re-running a finished
    # assignment wastes money; re-running a failed one *identically* reproduces
    # the failure. So the prior outcome becomes attempt 1, and the ladder picks
    # up from the obstacle it actually hit.
    if not dry_run:
        if key != f"tower-{role}":
            # The assignment was rewritten. A finished answer to the previous
            # wording is not an answer to this one, and treating it as one is
            # the quietest way to ship nothing while reporting success.
            print("  el encargo cambió desde la última ejecución; no reanudo",
                  flush=True)
            event(key, role, "brief_changed", {"previous": f"tower-{role}"})
        previous = evidence_for(key)
        if previous["status"] == "done" and previous["final"]:
            return {"role": role, "reached": True, "attempts": [
                {"attempt": 1, "job": key, "status": "done",
                 "obstacle": None, "resumed": True}]}
        if previous["status"]:
            obstacle = classify(previous)
            tried.append({"attempt": 1, "job": key,
                          "status": previous["status"], "obstacle": obstacle,
                          "resumed": True})
            first = 2
            print(f"  intento 1: {previous['status']} ({obstacle}) "
                  "— recuperado del intento anterior", flush=True)

    for attempt in range(first, max_attempts + 1):
        job = key if attempt == 1 else f"{key}-r{attempt}"
        previous_job = key if attempt == 2 else f"{key}-r{attempt - 1}"
        plan = ({"brief": brief, "budget": turn_budget(role), "window": 900} if attempt == 1
                else approach(role, obstacle, attempt, brief, previous_job))
        if plan:
            # A rung answers *how* to retry, not how little to spend. Its
            # literal budgets predate per-role budgets, so a recovery for the
            # designer was handing back 24 turns against a role baseline of 32
            # — the retry started poorer than the attempt that just failed.
            plan["budget"] = max(plan["budget"], turn_budget(role))
            plan["window"] = fits(plan["budget"], plan["window"])
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
    event(key, role, "pursuit_exhausted", result)
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
