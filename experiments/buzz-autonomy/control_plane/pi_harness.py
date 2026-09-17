"""Run a code-plane role on the pi harness and return what it actually did.

pi does not speak ACP, so the code plane cannot ride the same live channel
transport the Hermes roles use. Rather than pretend otherwise with a shim, the
dispatcher invokes pi non-interactively and publishes the result to Buzz itself.
That matches the control-plane design: the dispatcher is predictable code and
the harness is a worker, not a participant.

Two properties are enforced here instead of in the prompt, because a prompt
constraint is a request and a flag is a guarantee:

* Tools are allowlisted per role. The architect and the reviewer get no `write`
  and no `edit`; an architect that silently refactors the code it was asked to
  assess has destroyed the independence that made the assessment worth reading.
* The run is confined to one working directory, passed explicitly. pi resolves
  project trust and context files from its cwd, so the cwd IS the scope.
"""
import json
import os
import re
from pathlib import Path
import signal
import shutil
import subprocess
import threading
import time
from collections.abc import Callable

from pilot import MODEL, ROOT

from . import telemetry
from .roster import CONTRACTS, PI

PI_BIN = shutil.which("pi") or os.path.expanduser("~/.nvm/versions/node/v24.15.0/bin/pi")
PI_COMMAND_GUARD = Path(__file__).with_name("pi_command_guard.ts")

# Read-only roles keep `bash` because inspecting a repository means running
# `git log`, `cargo check` and the test suite. What they lose is the ability to
# leave a change behind. `bash` can of course write; the allowlist is a guard
# against the accidental case, not a sandbox, and is reported as such.
TOOLS = {
    "arquitecto": ("read", "grep", "find", "ls", "bash"),
    "revisor": ("read", "grep", "find", "ls", "bash"),
    "coder": ("read", "grep", "find", "ls", "bash", "edit", "write"),
}

DEFAULT_TIMEOUT = None
MAX_CAPTURE_BYTES = int(os.environ.get("BUZZ_PI_MAX_CAPTURE_BYTES", str(8 * 1024 * 1024)))
POLL_SECONDS = 1


def _drain(stream, path: Path, stats: dict) -> None:
    """Drain a child pipe without retaining unbounded model output in memory."""
    total = 0
    try:
        with path.open("wb") as output:
            while True:
                chunk = stream.read(8192)
                if not chunk:
                    break
                total += len(chunk)
                if total <= MAX_CAPTURE_BYTES:
                    output.write(chunk)
                elif total - len(chunk) < MAX_CAPTURE_BYTES:
                    output.write(chunk[:MAX_CAPTURE_BYTES - (total - len(chunk))])
    finally:
        stats["bytes"] = total
        stats["truncated"] = total > MAX_CAPTURE_BYTES


def _terminate_tree(process: subprocess.Popen) -> None:
    """Stop the whole Pi process group, including a child tool still running."""
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait(timeout=5)


def _execute(command: list[str], cwd: str, env: dict, timeout: int | None,
             checkpoint_path: Path, cancel_path: Path | None,
             cancel_check: Callable[[], bool] | None = None) -> subprocess.CompletedProcess:
    """Run Pi with a persistent bounded stream and an explicit cancellation path.

    `timeout=None` is intentional: a slow model is valid work. When a timeout
    is supplied for a diagnostic run, the process group is terminated rather
    than only the direct child, which avoids the orphan observed in the first
    Tower launch.
    """
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path = checkpoint_path.with_suffix(".stderr.log")
    process = subprocess.Popen(
        command, cwd=cwd, text=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, env=env,
    )
    stdout_stats, stderr_stats = {}, {}
    stdout_thread = threading.Thread(
        target=_drain, args=(process.stdout, checkpoint_path, stdout_stats), daemon=True
    )
    stderr_thread = threading.Thread(
        target=_drain, args=(process.stderr, stderr_path, stderr_stats), daemon=True
    )
    stdout_thread.start()
    stderr_thread.start()
    deadline = time.monotonic() + timeout if timeout is not None else None
    try:
        while process.poll() is None:
            if (cancel_path and cancel_path.exists()) or (cancel_check and cancel_check()):
                _terminate_tree(process)
                source = cancel_path if cancel_path and cancel_path.exists() else "job state"
                raise RuntimeError(f"pi run cancelled by {source}")
            if deadline is not None and time.monotonic() >= deadline:
                _terminate_tree(process)
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                process.wait(timeout=POLL_SECONDS)
            except subprocess.TimeoutExpired:
                continue
    finally:
        if process.poll() is None:
            _terminate_tree(process)
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        # Popen owns the pipe file descriptors. The drainers have finished, so
        # close them here even on cancellation/timeout; otherwise long-lived
        # launchers accumulate a descriptor per attempt and eventually fail in
        # a way that looks like model slowness.
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()

    stdout = checkpoint_path.read_text(encoding="utf-8", errors="replace")
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace")
    if stdout_stats.get("truncated"):
        stdout += "\n[pi output truncated at configured capture limit]\n"
    if stderr_stats.get("truncated"):
        stderr += "\n[pi stderr truncated at configured capture limit]\n"
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def _quarantine_if_poisoned(session_id: str, stdout: str) -> None:
    """A session pi can no longer replay must not be replayed again.

    Without this the same poisoned history is re-sent on every attempt, which
    is how a single PNG read cost nine backed-off retries and would have cost
    every future run of this job too.
    """
    if POISONED.search(stdout or ""):
        moved = quarantine_session(
            session_id,
            "Sesión irreproducible: el historial contiene una imagen y el combo "
            "no tiene modelo con visión (400 capability_mismatch). Se conserva "
            "como evidencia; el siguiente intento arranca limpio.")
        if moved:
            print(f"  sesión {session_id} puesta en cuarentena: {', '.join(moved)}",
                  flush=True)


def run(role: str, prompt: str, cwd: str, timeout: int | None = DEFAULT_TIMEOUT,
        job: str | None = None, checkpoint_path: str | Path | None = None,
        cancel_path: str | Path | None = None,
        cancel_check: Callable[[], bool] | None = None) -> dict:
    """Execute one long-running pi turn for a code-plane role.

    Returns the parsed run record. A non-zero exit or unparseable output is
    raised rather than summarized: a code agent whose result could not be read
    has not produced a result, and reporting it as an empty success is exactly
    the catch-log-and-continue failure the review rules forbid.
    """
    contract = CONTRACTS[role]
    if contract["harness"] != PI:
        raise ValueError(f"{role!r} is a Hermes role; use the ACP bridge, not pi")
    if not os.path.isdir(cwd):
        raise NotADirectoryError(f"Working directory does not exist: {cwd}")

    from .roster import instruction

    # The model is passed explicitly rather than inherited from pi's global
    # `defaultModel`. A settings file outside this repo deciding which model our
    # agents use is a dependency nobody would think to check when a run looks
    # wrong, and it drifts silently.
    session_dir = ROOT / "runs" / "pi-sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    session_id = job or f"{role}-{time.time_ns()}"
    command = [
        PI_BIN,
        "-p", prompt,
        "--system-prompt", instruction(role),
        "--mode", "json",
        "--model", MODEL,
        "--tools", ",".join(TOOLS[role]),
        "--extension", str(PI_COMMAND_GUARD),
        "--session-id", session_id,
        "--session-dir", str(session_dir),
    ]
    checkpoint = Path(checkpoint_path) if checkpoint_path else (
        ROOT / "runs" / "pi-checkpoints" / f"{session_id}.jsonl"
    )
    cancellation = Path(cancel_path) if cancel_path else None
    with telemetry.turn(role, harness="pi", model=MODEL) as span:
        try:
            result = _execute(
                command, cwd, {**os.environ, "PI_ROLE": role}, timeout,
                checkpoint, cancellation, cancel_check,
            )
        except Exception:
            raise
        else:
            _quarantine_if_poisoned(session_id, result.stdout)
        record = _finish(role, result)
        # pi carries no OpenTelemetry of its own, so the dispatcher records the
        # turn on its behalf from the usage pi already reports. Instrumenting pi
        # internally would mean patching a tool we do not own, for a number it
        # already hands us.
        usage = record.get("usage") or {}
        telemetry.record_usage(
            span,
            usage.get("input", 0),
            usage.get("output", 0),
            record.get("model"), job=job, role=role, harness="pi",
        )
        record["trace_id"] = telemetry.trace_id_of(span)
        return record


def _finish(role: str, result: subprocess.CompletedProcess) -> dict:
    """Turn a completed pi process into a run record, or raise."""
    if result.returncode:
        raise RuntimeError(
            f"pi run failed for {role} ({result.returncode}): {result.stderr[-800:]}"
        )
    if not result.stdout.strip():
        raise RuntimeError(f"pi returned no output for {role}; nothing was produced")
    return _parse(role, result.stdout)


POISONED = re.compile(r"capability_mismatch|vision support", re.I)


def quarantine_session(session_id: str, reason: str) -> list[str]:
    """Move a session pi can no longer replay, keeping it as evidence.

    `tower-coder` read a PNG. pi turned the result into an
    `{"type":"image","data":"iVBORw0KGgo..."}` block inside the session
    history, and because every run resumes by `--session-id`, that block was
    re-sent on each attempt to a combo with no vision model. The reply was a
    permanent `400 capability_mismatch`, so the session could never run again
    and the ladder retried it nine times.

    The history is unusable but not worthless: it is the record of what the
    agent did before it poisoned itself. So it is moved aside rather than
    deleted, and the next run starts clean.
    """
    session_dir = ROOT / "runs" / "pi-sessions"
    quarantine = session_dir / "quarantined"
    moved = []
    for path in sorted(session_dir.glob(f"*_{session_id}.jsonl")):
        quarantine.mkdir(parents=True, exist_ok=True)
        target = quarantine / path.name
        path.rename(target)
        moved.append(target.name)
    if moved:
        (quarantine / f"{session_id}.reason.txt").write_text(reason + "\n")
    return moved


def _parse(role: str, stdout: str) -> dict:
    """Reduce pi's JSONL event stream to the run record the dispatcher needs.

    `--mode json` streams one event per line, not a single document. Measured
    shape: session, agent_start, turn_start, message_*, turn_end, agent_end,
    agent_settled. The final answer and the token usage live on `agent_end`.

    An unparseable line is collected rather than ignored. Silently skipping
    malformed events would let a truncated or failed run be reported as a clean
    one, which is the failure mode that matters here — a code agent's result is
    trusted enough to be acted on.
    """
    events, broken = [], []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            broken.append(line[:200])
    end = next((e for e in reversed(events) if e.get("type") == "agent_end"), None)
    if broken and end is None:
        # No outcome and a damaged transcript: the run is genuinely unknown.
        raise RuntimeError(
            f"pi emitted {len(broken)} unparseable line(s) for {role}; "
            f"the run cannot be trusted. First: {broken[0]!r}"
        )
    if broken:
        # `tower-coder` lost a completed run to 3 damaged lines out of 5942 —
        # and, far worse, the parser error *replaced* the real cause, which
        # `agent_end` was carrying intact: a 503 from the model endpoint. The
        # operator was sent to debug a parser while the endpoint was down.
        #
        # The damage is pi's own stdout interleaving its JSONL events with the
        # bash tool's output (`{"type":"message_update","usa ===\"; ls ...`),
        # so it is not ours to prevent here. The transcript is evidence; the
        # outcome lives in `agent_end`. Keep the outcome, and mark the
        # transcript damaged so nobody reads it as complete.
        pass
    if end is None:
        raise RuntimeError(
            f"pi never reported agent_end for {role}; the turn did not complete"
        )
    if end.get("willRetry"):
        raise RuntimeError(f"pi ended the turn for {role} in a retrying state")

    messages = end.get("messages") or []
    final = ""
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        final = "".join(
            part.get("text", "")
            for part in message.get("content", [])
            if part.get("type") == "text"
        ).strip()
        if final:
            break
    if not final:
        # When the endpoint refuses the turn, `agent_end` carries the reason and
        # the message list is empty. Reporting only "no final answer" sent the
        # operator hunting through the harness for an outage upstream of it:
        # the real line was `503 chat_admission_busy — retry shortly`. Say what
        # the model said, and name it as upstream so the ladder can wait rather
        # than spend a rung rewriting a brief that was never the problem.
        upstream = next((m.get("errorMessage") for m in reversed(messages)
                         if m.get("stopReason") == "error" and m.get("errorMessage")), None)
        if upstream:
            raise RuntimeError(f"upstream model error for {role}: {str(upstream)[:300]}")
        raise RuntimeError(f"pi produced no final answer for {role}")

    usage = next(
        (m.get("usage") for m in reversed(messages) if m.get("usage")), {}
    )
    tools = [
        m.get("toolName")
        for m in messages
        if m.get("role") == "toolResult" and m.get("toolName")
    ]
    return {
        "role": role,
        "final": final,
        "model": next(
            (m.get("model") for m in reversed(messages) if m.get("model")), None
        ),
        "tools_used": tools,
        "tool_errors": sum(
            1 for m in messages if m.get("role") == "toolResult" and m.get("isError")
        ),
        "usage": usage,
        "events": len(events),
    }
