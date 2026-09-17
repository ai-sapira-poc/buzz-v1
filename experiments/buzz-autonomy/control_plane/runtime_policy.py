"""Runtime limits for agents whose useful work may span hours or days.

Wall-clock duration is an operational safety valve, not a quality criterion.
The long-running control-plane defaults therefore allow one ACP turn to last up
to the harness' seven-day ceiling and allow the outer process to stay resident.
Callers can still provide a shorter diagnostic limit explicitly.
"""
import os

DEFAULT_MAX_TURN_SECONDS = 604_800
DEFAULT_IDLE_SECONDS = 604_700


def _seconds(name: str, default: int) -> int:
    raw = os.environ.get(name)
    value = default if raw is None else int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be a positive number of seconds")
    return value


def acp_args(duration: int | None = None) -> list[str]:
    """Build ACP liveness arguments without imposing a short default timeout."""
    max_turn = _seconds("BUZZ_ACP_MAX_TURN_DURATION", DEFAULT_MAX_TURN_SECONDS)
    idle_default = min(DEFAULT_IDLE_SECONDS, max_turn - 1)
    if idle_default < 1:
        raise ValueError("BUZZ_ACP_MAX_TURN_DURATION must be greater than one second")
    idle = _seconds("BUZZ_ACP_IDLE_TIMEOUT", idle_default)
    if idle >= max_turn:
        raise ValueError(
            "BUZZ_ACP_IDLE_TIMEOUT must be less than BUZZ_ACP_MAX_TURN_DURATION"
        )
    args = ["--idle-timeout", str(idle), "--max-turn-duration", str(max_turn)]
    if duration is not None and duration > 0:
        args += ["--exit-after-inactivity", str(duration)]
    return args


def wait_timeout(duration: int | None) -> int | None:
    """Return an outer-process timeout only when the caller explicitly asks."""
    if duration is None or duration <= 0:
        return None
    return duration + 120
