"""Keep the business-plane agents listening, and restart them when they exit.

The gap this closes: `run_hermes.py` runs one agent for a bounded window, which
is right for a test and useless for actually working. An agent that exits after
fifteen minutes means the operator writes in the channel and nothing answers —
with no error anywhere, because nothing failed. It simply was not there.

Each role gets a supervised child process. `--exit-after-inactivity` still fires
inside buzz-acp, and this supervisor restarts it, so idle agents cost nothing
while remaining reachable within a few seconds of a message arriving.

    ~/.hermes/hermes-agent/venv/bin/python control_plane/serve.py
    ~/.hermes/hermes-agent/venv/bin/python control_plane/serve.py --status
    ~/.hermes/hermes-agent/venv/bin/python control_plane/serve.py --stop
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from pilot import ROOT
from control_plane.roster import ROLES
from control_plane.run_hermes import CONTROL_PLANE_CHANNEL

PID_DIR = ROOT / "run"
RESTART_BACKOFF = 5
WINDOW = 1800


def pid_file(role: str) -> Path:
    return PID_DIR / f"{role}.pid"


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def running(role: str) -> int | None:
    path = pid_file(role)
    if not path.is_file():
        return None
    try:
        pid = int(path.read_text().strip())
    except ValueError:
        return None
    return pid if alive(pid) else None


def start(role: str, channel: str) -> int:
    PID_DIR.mkdir(parents=True, exist_ok=True)
    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    script = Path(__file__).with_name("supervise_one.py")
    with (logs / f"serve-{role}.log").open("a") as out:
        process = subprocess.Popen(
            [sys.executable, str(script), role, "--channel", channel],
            stdout=out, stderr=out, start_new_session=True,
        )
    pid_file(role).write_text(str(process.pid))
    return process.pid


def stop(role: str) -> bool:
    pid = running(role)
    if pid is None:
        return False
    try:
        # Kill the group: the supervisor owns a buzz-acp child, and signalling
        # only the parent would leave that child holding the relay connection.
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except OSError:
        return False
    pid_file(role).unlink(missing_ok=True)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", default=CONTROL_PLANE_CHANNEL)
    parser.add_argument("--roles", help="comma-separated subset")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()

    # Every role, both harnesses. `supervise_one` routes each to its own engine;
    # leaving the code roles out here is what made them unreachable in practice.
    roles = args.roles.split(",") if args.roles else list(ROLES)

    if args.status:
        for role in roles:
            pid = running(role)
            print(f"  {role:12} {'escuchando pid ' + str(pid) if pid else 'parado'}")
        return 0

    if args.stop:
        for role in roles:
            print(f"  {role:12} {'detenido' if stop(role) else 'no estaba corriendo'}")
        return 0

    print(f"canal: {args.channel}\n")
    for role in roles:
        pid = running(role)
        if pid:
            print(f"  {role:12} ya escuchando (pid {pid})")
            continue
        print(f"  {role:12} arrancado (pid {start(role, args.channel)})")
        time.sleep(1)
    print("\nA cada agente hay que mencionarlo por su nombre, incluido el maestro"
          "\n(@Maestro). Estado: serve.py --status")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
