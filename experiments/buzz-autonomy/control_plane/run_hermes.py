"""Launch one business-plane role as a live Buzz agent on the control-plane channel.

The Hermes roles participate in the channel rather than being called by the
dispatcher: they listen over ACP, answer in the thread, and their reply is the
deliverable. That is the opposite of the pi roles, which the dispatcher invokes
and whose output it publishes.

`BUZZ_CONTROL_PLANE=1` is set here, which is what makes `profiles.instruction`
serve the ten-role roster instead of the fourteen legacy contracts. Setting it
at the launcher rather than in a shell profile keeps the default off, so any
older pilot evidence still replays under the instructions it was produced with.
"""
import argparse
import os
import signal
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Import the package first, and before `pilot`. Run as a script this file is
# `__main__`, so `control_plane/__init__.py` does not execute on its own — and
# that __init__ is what pins BUZZ_PILOT_HOME. Importing `pilot` ahead of it
# resolves the wrong community directory and fails later with a bare KeyError.
import control_plane  # noqa: F401  (import for its side effect, deliberately)

from pilot import ROOT, REPO, config
from control_plane.roster import BUSINESS_ROLES, CONTRACTS, HERMES

CONTROL_PLANE_CHANNEL = "0af36b11-a89b-4071-8388-6a985ed2aa7d"


def subscribe_mode(role: str) -> str:
    """Every role waits to be named, including the maestro.

    The maestro ran with `subscribe=all` so the operator would not have to tag
    his own chief of staff. Measured against this relay, that mode delivered
    **nothing**: with `all`, six minutes and a confirmed mention produced zero
    `admitted event` lines in the harness log; restarted with `mentions`, the
    same mention was admitted in under a second. Admission happens inside
    buzz-acp, before any gate of ours, so this is the harness or the relay, not
    our claim logic.

    A convenience that silently removes the agent from the conversation is not a
    convenience. Tagging `@Maestro` is a small cost; being ignored is not.
    Restore `all` only with a log line proving an event arrived under it.

    `mentions` is also the right default for a specialist on its own merits:
    seven agents waking on every message would be seven turns billed for one
    question.

    Reports cannot cause a loop: `inbound.claim` skips any message whose content
    starts with a `[job-id]` prefix, which is exactly how every agent report is
    published.
    """
    return "mentions"


def run(role: str, channel: str = CONTROL_PLANE_CHANNEL, duration: int = 900) -> int:
    contract = CONTRACTS[role]
    if contract["harness"] != HERMES:
        raise ValueError(f"{role!r} runs on pi; use control_plane.pi_harness instead")

    c = config()
    identity = c["identities"][contract["identity"]]
    relay = c["relay"].replace("https://", "wss://").replace("http://", "ws://")

    # The inbound gate defaults to owner-only, which is the right default for a
    # lone assistant and the wrong one for a team: the maestro could never
    # delegate, and no role could hand work to the next. Widen it to exactly the
    # ten teammates — the owner is always implicitly included — rather than to
    # `anyone`, so a message from an unrelated community member still cannot
    # task an agent. Only the mentioned agent wakes, so this does not fan out.
    siblings = ",".join(
        sorted(
            c["identities"][other["identity"]]["pubkey"]
            for name, other in CONTRACTS.items()
            if name != role
        )
    )
    env = {
        **os.environ,
        "BUZZ_CONTROL_PLANE": "1",
        "BUZZ_PRIVATE_KEY": identity["secret"],
        "BUZZ_AUTH_TAG": identity["auth_tag"],
        "BUZZ_RELAY_URL": relay,
        "BUZZ_PILOT_ROLE": contract["identity"],
        "BUZZ_ACP_AGENT_OWNER": c["viewer"],
        "BUZZ_ACP_AGENT_COMMAND": str(ROOT / "bin/hermes-pilot"),
        "BUZZ_ACP_AGENT_ARGS": "",
        "BUZZ_ACP_MULTIPLE_EVENT_HANDLING": "queue",
        "BUZZ_ACP_SESSION_POLICY": "thread",
        "BUZZ_ACP_CHANNELS": channel,
        # An answer belongs in the channel where the question was asked. Without
        # this, `reporting.target_channel` falls back to the community default
        # and a reply to a project-channel mention lands somewhere nobody is
        # looking — the same wrong-channel defect as the claim gate, on the way
        # out instead of the way in. One launch, one channel, both directions.
        "BUZZ_PUBLISH_CHANNEL": channel,
        "BUZZ_ACP_NO_MEMORY": "true",
        "BUZZ_ACP_NO_BASE_PROMPT": "true",
        "BUZZ_ACP_RESPOND_TO": "allowlist",
        "BUZZ_ACP_RESPOND_TO_ALLOWLIST": siblings,
        "BUZZ_ACP_SUBSCRIBE": os.environ.get(
            "BUZZ_ACP_SUBSCRIBE", subscribe_mode(role)
        ),
    }
    # Keep the harness gate and the claim gate in agreement. An agent listening
    # to everything must also be allowed to claim an unmentioned message, or it
    # accepts the event and then silently refuses to work on it.
    if env["BUZZ_ACP_SUBSCRIBE"] == "all":
        env["BUZZ_CLAIM_UNMENTIONED"] = "1"
    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    log = logs / f"control-plane-{role}.log"
    with log.open("a") as output:
        process = subprocess.Popen(
            [str(REPO / "target/debug/buzz-acp"),
             "--idle-timeout", "300", "--max-turn-duration", "600",
             "--exit-after-inactivity", str(duration), "--permission-mode", "dont-ask"],
            env=env, stdout=output, stderr=output, start_new_session=True,
        )
        print(f"{role} ({contract['identity']}) pid={process.pid} log={log}", flush=True)
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
    parser.add_argument("role", choices=BUSINESS_ROLES)
    parser.add_argument("--channel", default=CONTROL_PLANE_CHANNEL)
    parser.add_argument("--duration", type=int, default=900)
    args = parser.parse_args()
    raise SystemExit(run(args.role, args.channel, args.duration))
