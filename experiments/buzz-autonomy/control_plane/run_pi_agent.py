"""Run a code-plane role as a live Buzz agent, with pi behind an ACP adapter.

This is what makes the maestro's job simple: it mentions `coder` in the channel
and gets an answer. That the answer came from pi rather than Hermes is this
file's business and nobody else's — which is the whole point of routing by role
instead of by plumbing.

`buzz-acp` hosts any process that speaks ACP over stdio. pi does not, but
`pi-acp` bridges ACP to `pi --mode rpc`, so the harness command is simply
`pi-acp`. No fork of buzz-acp, no dispatcher, no second transport.

The working directory IS the scope: pi resolves project trust and its context
files (AGENTS.md, CLAUDE.md) from cwd, so the agent is confined to the repo it
is started in.
"""
import argparse
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from pilot import ROOT, REPO, MODEL, config
from control_plane.roster import CODE_ROLES, CONTRACTS, PI, instruction
from control_plane.run_hermes import CONTROL_PLANE_CHANNEL

PI_ACP = shutil.which("pi-acp") or "pi-acp"


def run(role: str, channel: str = CONTROL_PLANE_CHANNEL, cwd: str | None = None,
        duration: int = 1800) -> int:
    contract = CONTRACTS[role]
    if contract["harness"] != PI:
        raise ValueError(f"{role!r} runs on Hermes; use control_plane.run_hermes")

    c = config()
    identity = c["identities"][contract["identity"]]
    relay = c["relay"].replace("https://", "wss://").replace("http://", "ws://")
    workdir = cwd or str(REPO)

    siblings = ",".join(sorted(
        c["identities"][other["identity"]]["pubkey"]
        for name, other in CONTRACTS.items() if name != role
    ))

    env = {
        **os.environ,
        "BUZZ_CONTROL_PLANE": "1",
        "BUZZ_PRIVATE_KEY": identity["secret"],
        "BUZZ_AUTH_TAG": identity["auth_tag"],
        "BUZZ_RELAY_URL": relay,
        "BUZZ_ACP_AGENT_OWNER": c["viewer"],
        "BUZZ_ACP_AGENT_COMMAND": PI_ACP,
        "BUZZ_ACP_AGENT_ARGS": "",
        "BUZZ_ACP_MULTIPLE_EVENT_HANDLING": "queue",
        "BUZZ_ACP_SESSION_POLICY": "thread",
        "BUZZ_ACP_CHANNELS": channel,
        "BUZZ_ACP_RESPOND_TO": "allowlist",
        "BUZZ_ACP_RESPOND_TO_ALLOWLIST": siblings,
        "BUZZ_ACP_SUBSCRIBE": "mentions",
        # pi reads these itself; passing them explicitly keeps the model choice
        # out of a settings file nobody would think to check.
        "PI_ROLE": role,
    }

    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    # The role contract goes to pi as an appended system prompt. pi-acp forwards
    # PI_* nothing of the sort, so it is written where pi itself will read it:
    # a project-local instruction file in the working directory is the seam pi
    # already honours.
    (logs / f"{role}-instruction.md").write_text(instruction(role), encoding="utf-8")

    log = logs / f"control-plane-{role}.log"
    with log.open("a") as output:
        process = subprocess.Popen(
            [str(REPO / "target/debug/buzz-acp"),
             "--idle-timeout", "300", "--max-turn-duration", "900",
             "--exit-after-inactivity", str(duration), "--permission-mode", "dont-ask"],
            env=env, cwd=workdir, stdout=output, stderr=output, start_new_session=True,
        )
        print(f"{role} ({contract['identity']}) pid={process.pid} "
              f"harness=pi-acp cwd={workdir} log={log}", flush=True)
        try:
            return process.wait(timeout=duration + 120)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=CODE_ROLES)
    parser.add_argument("--channel", default=CONTROL_PLANE_CHANNEL)
    parser.add_argument("--cwd", default=None)
    parser.add_argument("--duration", type=int, default=1800)
    args = parser.parse_args()
    raise SystemExit(run(args.role, args.channel, args.cwd, args.duration))
