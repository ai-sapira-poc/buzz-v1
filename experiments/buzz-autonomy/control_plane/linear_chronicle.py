"""Turn what the team said in Buzz into a project update in Linear.

The role this fills is the one you asked for: somebody whose whole job is that
the Linear project reflects what actually happened, without a human relaying it.

It is deliberately **not** an inference agent. The chronicle is a projection of
the channel — who spoke, about what, with which evidence — so an update can
never claim progress that was not published. An LLM writing the summary would be
able to, and a status update that can be wrong is worse than none.

    python control_plane/linear_chronicle.py --since 6h            # print it
    python control_plane/linear_chronicle.py --since 6h --publish  # post it

Publishing needs `LINEAR_API_KEY` (a personal API key from Linear settings).
Without it the digest is still written to `artifacts/linear/`, so the update is
one paste away rather than lost.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from pilot import ROOT, BUZZ, config
from control_plane.roster import CONTRACTS

LINEAR_API = "https://api.linear.app/graphql"
LINEAR_PROJECT = "7f6bc73d-2c69-4846-bee2-8afc9af65ab4"  # Sapira AI › Buzz
DURATIONS = {"h": 3600, "d": 86400, "m": 60}
EVIDENCE = re.compile(r"`?[\w./-]+\.(?:rs|ts|tsx|py|md|dart|toml|yaml|yml):\d+`?")


def seconds(window: str) -> int:
    match = re.fullmatch(r"(\d+)([hdm])", window.strip().lower())
    if not match:
        raise ValueError(f"ventana no reconocida: {window!r} (usa 90m, 6h, 2d)")
    return int(match.group(1)) * DURATIONS[match.group(2)]


def who() -> dict[str, str]:
    """pubkey → role name, so the digest names teammates and not hex."""
    c = config()
    names = {}
    for role, contract in CONTRACTS.items():
        identity = c["identities"].get(contract["identity"])
        if identity:
            names[identity["pubkey"]] = role
    names[c["viewer"]] = "alex"
    return names


def messages(channel: str, since: int) -> list[dict]:
    result = subprocess.run(
        [str(BUZZ), "messages", "get", "--channel", channel,
         "--since", str(since), "--limit", "200"],
        capture_output=True, text=True, check=True,
        env={**os.environ, **credentials()},
    )
    return json.loads(result.stdout or "[]")


def credentials() -> dict[str, str]:
    c = config()
    identity = c["identities"][CONTRACTS["maestro"]["identity"]]
    return {
        "BUZZ_RELAY_URL": c["relay"],
        "BUZZ_PRIVATE_KEY": identity["secret"],
        "BUZZ_AUTH_TAG": identity["auth_tag"],
    }


def digest(channel: str, window: str) -> str:
    since = int(time.time()) - seconds(window)
    names = who()
    events = sorted(messages(channel, since), key=lambda e: e["created_at"])

    spoke: dict[str, int] = {}
    lines, evidence = [], set()
    for e in events:
        speaker = names.get(e["pubkey"], e["pubkey"][:8])
        spoke[speaker] = spoke.get(speaker, 0) + 1
        evidence.update(m.strip("`") for m in EVIDENCE.findall(e["content"]))
        first = next((l for l in e["content"].splitlines() if l.strip()), "")
        first = re.sub(r"^\[[\w-]+\]\s*", "", first.strip())
        if first:
            lines.append(f"- **{speaker}**: {first[:180]}")

    if not events:
        return (f"## Sin actividad\n\nNingún mensaje en el canal en las últimas "
                f"{window}. El equipo está parado o nadie le ha encargado nada.")

    participants = ", ".join(f"{n} ({c})" for n, c in
                             sorted(spoke.items(), key=lambda kv: -kv[1]))
    body = [
        f"## Últimas {window} en el canal de Buzz",
        "",
        f"**Quién habló:** {participants}",
        f"**Mensajes:** {len(events)}",
        "",
        "### Qué se dijo",
        *lines[-25:],
    ]
    if evidence:
        body += ["", "### Evidencia citada",
                 *(f"- `{e.strip('`')}`" for e in sorted(evidence)[:15])]
    body += ["", "_Proyección automática del canal; no es un resumen inferido._"]
    return "\n".join(body)


def publish(body: str, health: str = "onTrack") -> dict:
    key = os.environ.get("LINEAR_API_KEY")
    if not key:
        raise PermissionError(
            "falta LINEAR_API_KEY; el digest se ha guardado pero no se publica")
    query = ("mutation($input: ProjectUpdateCreateInput!) {"
             " projectUpdateCreate(input: $input) { success projectUpdate { id url } } }")
    payload = json.dumps({
        "query": query,
        "variables": {"input": {"projectId": LINEAR_PROJECT,
                                "body": body, "health": health}},
    }).encode()
    request = urllib.request.Request(
        LINEAR_API, data=payload,
        headers={"Authorization": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", default=None)
    parser.add_argument("--since", default="6h", help="90m, 6h, 2d")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--health", default="onTrack",
                        choices=["onTrack", "atRisk", "offTrack"])
    args = parser.parse_args()

    channel = args.channel or os.environ.get("BUZZ_PUBLISH_CHANNEL") or config()["channel"]
    body = digest(channel, args.since)

    out = ROOT / "artifacts" / "linear"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"update-{time.strftime('%Y%m%d-%H%M')}.md"
    path.write_text(body, encoding="utf-8")
    print(body)
    print(f"\n-- guardado en {path}", file=sys.stderr)

    if args.publish:
        try:
            result = publish(body, args.health)
        except PermissionError as error:
            print(f"-- {error}", file=sys.stderr)
            return 3
        print(f"-- publicado: {json.dumps(result)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
