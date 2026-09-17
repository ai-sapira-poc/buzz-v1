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
from control_plane.runtime_policy import acp_args, wait_timeout

# Buzz integrated its own pi adapter fork (PR #7552), pinned in the desktop
# preset at `managed_agents/discovery/presets.rs:113`. It replaces the
# third-party `pi-acp@0.0.x` we were using, and it is the one Buzz knows how to
# speak to: the harness sends the composed system prompt as `_meta.systemPrompt`
# on `session/new`, but only when the agent identifies itself as `buzz-pi-acp`
# (`crates/buzz-acp/src/acp.rs:26`). With the upstream adapter that prompt never
# arrives — which is what our own instruction-file workaround was papering over.
PI_ACP = shutil.which("buzz-pi-acp") or "buzz-pi-acp"
PI_COMMAND_GUARD = Path(__file__).with_name("pi_command_guard.ts")


def run(role: str, channel: str = CONTROL_PLANE_CHANNEL, cwd: str | None = None,
        duration: int | None = None) -> int:
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
        # buzz-acp splits this value on commas. The first `--` tells
        # buzz-pi-acp that the remaining arguments belong to Pi, so the same
        # per-command timeout guard is active for live code-plane agents and
        # for dispatcher-invoked Pi jobs.
        "BUZZ_ACP_AGENT_ARGS": f"--,--extension,{PI_COMMAND_GUARD}",
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
    # The role contract reaches the agent through the harness's own prompt
    # composition, which is the seam that actually exists. Writing it to a file
    # and hoping pi picked it up was a guess I never verified; `buzz-acp` reads
    # this path itself (`config.rs:292`) and hands the composed prompt to
    # `buzz-pi-acp` as `_meta.systemPrompt` on session/new.
    contract_file = logs / f"{role}-instruction.md"
    contract_file.write_text(instruction(role), encoding="utf-8")
    env["BUZZ_ACP_SYSTEM_PROMPT_FILE"] = str(contract_file)

    log = logs / f"control-plane-{role}.log"
    with log.open("a") as output:
        process = subprocess.Popen(
            [str(REPO / "target/debug/buzz-acp"),
             *acp_args(duration), "--permission-mode", "dont-ask"],
            env=env, cwd=workdir, stdout=output, stderr=output, start_new_session=True,
        )
        print(f"{role} ({contract['identity']}) pid={process.pid} "
              f"harness=pi-acp cwd={workdir} log={log}", flush=True)
        try:
            return process.wait(timeout=wait_timeout(duration))
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
    parser.add_argument("--duration", type=int, default=None,
                        help="optional inactivity lifetime; omit for a long-running agent")
    args = parser.parse_args()
    raise SystemExit(run(args.role, args.channel, args.cwd, args.duration))
