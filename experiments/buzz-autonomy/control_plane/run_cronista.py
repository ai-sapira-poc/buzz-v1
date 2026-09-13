"""Run the chronicler: read the Buzz channel, publish the update to Linear.

The chronicler is the one role that talks to something outside Buzz, and it does
it the way the operator already does — through Hermes' own Linear MCP session.
No API key is minted for it, so its access is exactly the operator's access and
disappears when that session does.

Two deliberate departures from how every other role runs:

* **It uses the operator's real `HERMES_HOME`**, not a pilot profile. The pilot
  profiles are empty homes, which is why the chronicler saw zero MCP tools and
  answered "SIN LINEAR" — the `mcp_servers` block and the OAuth session both
  live in `~/.hermes`.
* **The channel digest is computed, not recalled.** The agent is handed a
  deterministic projection of what was actually published and asked to write the
  update from it. A model summarising from memory can report progress that never
  happened, and a status update that can be wrong is worse than no update.

    python control_plane/run_cronista.py --since 6h
    python control_plane/run_cronista.py --since 6h --dry-run
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)

from pilot import HERMES, ROOT, config, event
from control_plane.roster import CONTRACTS, instruction
from control_plane.linear_chronicle import digest
from control_plane.tower_project import CHANNEL as TOWER_CHANNEL

OPERATOR_HERMES_HOME = str(Path.home() / ".hermes")
LINEAR_PROJECT = "Buzz"


def run(window: str = "6h", channel: str = TOWER_CHANNEL, dry_run: bool = False) -> str:
    job = f"cronista-{window}"
    projection = digest(channel, window)

    if dry_run:
        print(projection)
        return projection

    # The MCP session and the `mcp_servers` block live in the operator's home.
    # A pilot profile has neither, so the tools simply would not exist.
    os.environ["HERMES_HOME"] = OPERATOR_HERMES_HOME
    sys.path.insert(0, str(HERMES))
    from tools.mcp_tool import discover_mcp_tools

    discovered = discover_mcp_tools()
    writers = [t for t in discovered if t.endswith(("save_status_update", "save_comment"))]
    if not writers:
        raise RuntimeError(
            "Linear está en modo lectura para Hermes: falta save_status_update en "
            "el allowlist de mcp_servers.linear. El cronista no puede publicar."
        )

    from worker import make_agent

    agent = make_agent(CONTRACTS["cronista"]["identity"], job)
    agent.enabled_toolsets = list(agent.enabled_toolsets) + ["linear"]

    prompt = (
        f"Publica el estado del proyecto «{LINEAR_PROJECT}» en Linear.\n\n"
        "Abajo tienes la proyección literal del canal de Buzz en la ventana "
        f"de {window}. Es la única fuente: no añadas nada que no esté ahí, y si "
        "está vacía, publica que el equipo estuvo parado.\n\n"
        "Resuelve el proyecto con `list_projects`/`get_project`, lee el último "
        "update con `get_status_updates` para escribir deltas y no repetir, y "
        "publica con `save_status_update`. Elige la salud con honestidad.\n\n"
        "--- PROYECCIÓN DEL CANAL ---\n" + projection
    )
    result = agent.run_conversation(
        user_message=prompt, system_message=instruction("cronista")
    )
    final = result.get("final_response", "")
    event(job, "cronista", "linear_update", {
        "window": window, "channel": channel,
        "exit": result.get("turn_exit_reason"), "published": bool(final),
    })
    print(final)
    return final


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default="6h", help="90m, 6h, 2d")
    parser.add_argument("--channel", default=TOWER_CHANNEL)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.since, args.channel, args.dry_run)
