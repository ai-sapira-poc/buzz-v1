"""Supervise one agent: run it, and when it exits, run it again.

Long-running work is the default. A healthy agent may stay quiet while a model
thinks for hours, so this supervisor restarts only an actual process exit. An
explicit duration can still be passed to the harness for a diagnostic run.

Restarts are logged with their reason, so "the agent was not there" is always
visible afterwards instead of being an absence of evidence.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from control_plane.roster import CONTRACTS, PI
from control_plane.run_hermes import CONTROL_PLANE_CHANNEL

WINDOW = None
BACKOFF = 5
MAX_BACKOFF = 120


def launcher(role: str):
    """Pick the harness this role runs on.

    Supervising only the Hermes roles was a silent hole: `serve.py` would happily
    accept `coder` and start it on Hermes, so a code role would answer — with the
    wrong engine, and no error to say so. The role contract decides, here, once.
    """
    if CONTRACTS[role]["harness"] == PI:
        from control_plane.run_pi_agent import run as run_pi

        return run_pi
    from control_plane.run_hermes import run as run_hermes

    return run_hermes


def supervise(role: str, channel: str) -> int:
    run = launcher(role)
    backoff = BACKOFF
    while True:
        started = time.time()
        try:
            code = run(role, channel, duration=WINDOW)
            reason = f"salida {code}"
        except Exception as error:  # noqa: BLE001 - a crash must not end supervision
            reason = f"{type(error).__name__}: {error}"
            code = 1
        lived = time.time() - started
        print(f"[{time.strftime('%H:%M:%S')}] {role}: {reason} tras {lived:.0f}s",
              flush=True)
        # A process that lived a full window exited normally on idle timeout;
        # restart it immediately. One that died in seconds is failing, so back
        # off — otherwise a permanent failure becomes a hot restart loop.
        if lived > 60:
            backoff = BACKOFF
        else:
            backoff = min(backoff * 2, MAX_BACKOFF)
            print(f"           reinicio en {backoff}s", flush=True)
        time.sleep(backoff)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role")
    parser.add_argument("--channel", default=CONTROL_PLANE_CHANNEL)
    args = parser.parse_args()
    raise SystemExit(supervise(args.role, args.channel))
