"""Run one existing pilot identity through Buzz ACP for a bounded local test."""
import argparse
import os
import signal
import subprocess

from pilot import ROOT, REPO, ROLES, config


def run(role, duration=480):
    c = config()
    identity = c["identities"][role]
    relay = c["relay"].replace("https://", "wss://").replace("http://", "ws://")
    env = {**os.environ, "BUZZ_PRIVATE_KEY": identity["secret"], "BUZZ_AUTH_TAG": identity["auth_tag"],
           "BUZZ_RELAY_URL": relay, "BUZZ_PILOT_ROLE": role, "BUZZ_ACP_AGENT_OWNER": c["viewer"],
           "BUZZ_ACP_AGENT_COMMAND": str(ROOT / "bin/hermes-pilot"), "BUZZ_ACP_AGENT_ARGS": "",
           "BUZZ_ACP_MULTIPLE_EVENT_HANDLING": "queue", "BUZZ_ACP_SESSION_POLICY": "thread",
           "BUZZ_ACP_CHANNELS": c["channel"], "BUZZ_ACP_NO_MEMORY": "true", "BUZZ_ACP_NO_BASE_PROMPT": "true"}
    logs = ROOT / "logs"; logs.mkdir(exist_ok=True)
    with (logs / ("native-" + role + ".log")).open("a") as output:
        process = subprocess.Popen(["rtk", "proxy", str(REPO / "target/debug/buzz-acp"),
            "--idle-timeout", "120", "--max-turn-duration", "180", "--exit-after-inactivity", "90",
            "--permission-mode", "dont-ask"], env=env, stdout=output, stderr=output, start_new_session=True)
        print(f"Pilot {role} ACP process: {process.pid}", flush=True)
        try:
            return process.wait(timeout=duration)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=ROLES)
    args = parser.parse_args()
    raise SystemExit(run(args.role))
