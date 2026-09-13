"""Stock Hermes ACP transport with a scoped real AIAgent factory."""
import asyncio
import os
import sys
import uuid

from pilot import HERMES, ROOT, ROLES, buzz, config, event, write_json

ROLE = os.environ.get("BUZZ_PILOT_ROLE", "maestro")
if ROLE not in ROLES:
    raise ValueError("Unknown pilot role")
os.environ["HERMES_HOME"] = str(ROOT / "profiles" / ROLE)
sys.path.insert(0, str(HERMES))

from acp import run_agent
from acp_adapter.server import HermesACPAgent
from acp_adapter.session import SessionManager
from worker import make_agent
from profiles import instruction
from context import initial
from reporting import publish
from inbound import ACTIVE_JOB, claim, finish
from evidence import handoff, snapshot, report, export_trace, completed


class ScopedSessions(SessionManager):
    def _make_agent(self, **kwargs):
        job = "acp-" + uuid.uuid4().hex
        agent = make_agent(ROLE, job)
        agent._print_fn = lambda *args, **kw: print(*args, file=sys.stderr)
        original = agent.run_conversation

        def scoped_conversation(*args, **kw):
            if (ROOT / "PAUSED").exists():
                return {"final_response": "Piloto pausado por el operador.", "messages": []}
            claimed = claim(ROLE, kw.get("user_message", args[0] if args else ""))
            if not claimed:
                return {"final_response": "Petición ya registrada o informe sin delegación; no se inicia trabajo duplicado.", "messages": []}
            current_job, content = claimed
            token = ACTIVE_JOB.set(current_job)
            try:
                c = config()
                event(current_job, ROLE, "agent_created", {"model": c["model"], "endpoint": c["endpoint"], "toolset": "pilot_" + ROLE, "acp_session": job})
                kw["user_message"] = content + "\n\n" + handoff(current_job)
                kw["system_message"] = instruction(ROLE) + "\n" + initial(ROLE, current_job) + "\nYour final answer is automatically posted to the pilot Buzz channel. Do not call arbitrary shell tools to publish. All customer data is simulation. Never claim human approval or policy promotion."
                result = original(**kw)
                report(current_job, result)
                snapshot(current_job, "after")
                final = result.get("final_response", "")
                if not final:
                    raise RuntimeError("Native conversation returned no final response")
                if not completed(result):
                    event(current_job, ROLE, "incomplete", {"reason": result.get("turn_exit_reason")})
                    publish(ROLE, current_job, "EJECUCIÓN INCOMPLETA: " + str(result.get("turn_exit_reason")) + "\n\n" + final)
                    export_trace(current_job)
                    finish(current_job, "failed")
                    return result
                from design_guard import completion
                completion(current_job)
                publish(ROLE, current_job, final)
                export_trace(current_job)
                finish(current_job, "done")
                if ROLE == "maestro":
                    from mandate import launch
                    try:
                        launch(current_job)
                    except Exception as exc:
                        event(current_job, ROLE, "driver_launch_failed", {"error": type(exc).__name__})
                return result
            except Exception:
                finish(current_job, "failed")
                raise
            finally:
                ACTIVE_JOB.reset(token)

        agent.run_conversation = scoped_conversation
        return agent


if __name__ == "__main__":
    asyncio.run(run_agent(HermesACPAgent(session_manager=ScopedSessions()), use_unstable_protocol=True))
