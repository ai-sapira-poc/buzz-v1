"""Enforced pilot capabilities. No arbitrary shell or connector mutation tool."""
import asyncio
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from pilot import ROOT, REPO, config, database, enqueue, event, safe_path

PERMISSIONS = {
    "maestro": {"read", "write", "remember", "recall", "delegate", "results"},
    "research": {"read", "write", "remember", "recall", "fetch"},
    "product": {"read", "write", "remember", "recall"},
    "designer": {"read", "write", "recall"},
    "coder": {"read", "write", "recall"},
    "reviewer": {"read", "write", "recall", "remember"},
    "tester": {"read", "write", "browser", "recall", "remember", "buzz"},
    "analyst": {"read", "write", "recall", "linear", "railway"},
    "strategy": {"read", "write", "recall", "remember"},
    "innovation": {"read", "write", "recall", "remember"},
    "ux": {"read", "write", "recall"},
    "architect": {"read", "write", "recall"},
    "operations": {"read", "write", "recall", "railway"},
    "editor": {"read", "write", "recall", "linear"},
}
PUBLIC_HOSTS = {"arxiv.org", "www.anthropic.com", "research.google", "deepmind.google"}


async def linear_project():
    """Use only the pilot's isolated OAuth credentials."""
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    token_path = ROOT / "connectors/linear/mcp-tokens/linear.json"
    if not token_path.exists():
        raise RuntimeError("Isolated Linear login required; main Hermes credentials are not used")
    token = json.loads(token_path.read_text())
    async with httpx.AsyncClient(headers={"Authorization": "Bearer " + token["access_token"]}, timeout=45) as client:
        async with streamable_http_client("https://mcp.linear.app/mcp", http_client=client) as (reader, writer, _):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                result = await session.call_tool("get_project", {"query": config()["linear"]["id"]})
                if result.isError:
                    raise RuntimeError("Linear read rejected")
                return result.model_dump(mode="json")


def railway_logs():
    c = config()["railway"]
    args = ["rtk", "proxy", str(Path.home() / ".railway/bin/railway"), "logs",
            "--project", c["project"], "--environment", c["environment"],
            "--service", c["service"], "--lines", "12", "--json"]
    r = subprocess.run(args, capture_output=True, text=True, timeout=45)
    if r.returncode:
        raise RuntimeError("Railway read failed: " + r.stderr[:300])
    return {"service": c["service"], "logs": r.stdout[:18000]}


# Reading the product as a user does. Only read verbs: the point of this role is
# to find out what the product is like to use, and a tester that can post,
# create or delete is a tester that changes what it is measuring.
BUZZ_READS = {
    "channels": {"list", "get", "members"},
    "messages": {"get", "search", "thread"},
    "projects": {"list", "get"},
    "issues": {"list", "get"},
    "notes": {"ls", "get"},
    "feed": {"get", ""},
    "users": {"get", "presence"},
    "workflows": {"list", "get", "runs"},
    "canvas": {"get"},
    "reactions": {"list"},
    "mem": {"ls", "get"},
}


def use_buzz(role, job, args):
    """Run a read-only Buzz command, as a person using the product would.

    This exists because the only honest way to know whether a feature delivers
    value is to use it. A report written from the source code describes what was
    built; this describes what it is like to operate — which is the thing the
    operator actually experiences and the thing nobody was measuring.

    Deliberately read-only. A tester that can post messages or create projects
    is changing the system it is measuring, and its findings stop being about
    the product and start being about its own noise.
    """
    command = args.get("command")
    subcommand = args.get("subcommand", "")
    if command not in BUZZ_READS:
        raise PermissionError(
            f"'{command}' no está disponible. Lecturas permitidas: "
            + ", ".join(sorted(BUZZ_READS))
        )
    if subcommand not in BUZZ_READS[command]:
        raise PermissionError(
            f"'{command} {subcommand}' no es una lectura. Permitidas para "
            f"{command}: {', '.join(sorted(s for s in BUZZ_READS[command] if s))}"
        )
    extra = args.get("args") or []
    if not isinstance(extra, list) or any(not isinstance(a, str) for a in extra):
        raise ValueError("args debe ser una lista de cadenas")
    if len(extra) > 12:
        raise ValueError("Demasiados argumentos para una lectura")

    from pilot import buzz as run_buzz

    argv = [command] + ([subcommand] if subcommand else []) + extra
    started = time.monotonic()

    # `--help` prints text, not JSON, so the normal path tried to parse it and
    # failed with "Expecting value: line 1 column 1". The tester's own run found
    # this: 14 of its 35 reads failed, most of them guessing at flag names it had
    # no way to look up. Blinding the role we built to find friction is the
    # friction. Upstream now renders an agent-friendly command tree in `--help`
    # (PR #7584); this is what lets our agents reach it.
    if "--help" in extra or "-h" in extra:
        from pilot import BUZZ, credentials_for

        process = subprocess.run(
            [str(BUZZ), *argv], capture_output=True, text=True, timeout=30,
            env=credentials_for(role),
        )
        elapsed = round((time.monotonic() - started) * 1000)
        event(job, role, "buzz_read", {"argv": argv, "ms": elapsed, "failed": False})
        return {"command": " ".join(argv), "ms": elapsed,
                "help": (process.stdout or process.stderr)[:8000]}
    try:
        result = run_buzz(role, argv)
        failure = None
    except Exception as error:  # noqa: BLE001 - a failed read IS a finding here
        # For this role a command that fails is data, not an accident: "I tried
        # to do X and the product would not let me" is exactly the report we
        # want. Swallowing it would hide the most valuable observations.
        result, failure = None, str(error)[:400]
    elapsed = round((time.monotonic() - started) * 1000)

    event(job, role, "buzz_read", {"argv": argv, "ms": elapsed,
                                   "failed": failure is not None})
    payload = {"command": " ".join(argv), "ms": elapsed}
    if failure is None:
        text = json.dumps(result, ensure_ascii=False)
        payload["result"] = json.loads(text) if len(text) <= 24000 else text[:24000]
        payload["truncated"] = len(text) > 24000
    else:
        payload["failed"] = True
        payload["error"] = failure
    return payload


# How many operations one batch may carry. Enough that reading a handful of
# files and writing the result is a single turn, small enough that a bad batch
# cannot spend the whole assignment before anyone sees it.
BATCH_LIMIT = 12
# Never inside a batch: `batch` would nest into a loop with no turn boundary to
# stop it, and `delegate` would spawn work that no one watched being created.
BATCH_FORBIDDEN = {"batch", "delegate"}


def run_batch(role, job, args):
    """Run several operations in one turn instead of one per turn.

    Borrowed from Uber's "code-mode": the expensive part of a tool call is not
    the work, it is that every intermediate result re-enters the model's context
    and is billed again on the next turn. Uber measured 55-71% fewer tokens on
    simple queries and over 90% on bulk work by moving the loop into a
    subprocess and returning only the summary.

    Here the loop moves into this function. The agent asks for five reads and a
    write, and pays for one turn's context instead of six.

    Every step still goes through `operate`, so permissions, pause and
    cancellation apply exactly as they would one at a time — this changes how
    many turns the work costs, never what the work is allowed to do.
    """
    steps = args.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError(
            'batch necesita {"steps": [{"action": ..., "args": {...}}, ...]}'
        )
    if len(steps) > BATCH_LIMIT:
        raise ValueError(f"Un batch admite hasta {BATCH_LIMIT} pasos; pediste {len(steps)}")

    results = []
    for index, step in enumerate(steps):
        if not isinstance(step, dict) or "action" not in step:
            raise ValueError(f"Paso {index} mal formado: necesita 'action' y 'args'")
        step_action = step["action"]
        if step_action in BATCH_FORBIDDEN:
            raise PermissionError(f"'{step_action}' no puede ir dentro de un batch")
        try:
            results.append({"step": index, "action": step_action, "ok": True,
                            "result": operate(role, job, step_action, step.get("args") or {})})
        except Exception as error:  # noqa: BLE001 - a failed step must not lose the rest
            # Stop here, but hand back everything that already succeeded. The
            # alternative — throwing the whole batch away — makes a batch riskier
            # than the sequential calls it replaces, which would defeat it.
            results.append({"step": index, "action": step_action, "ok": False,
                            "error": type(error).__name__, "message": str(error)[:300]})
            break
    event(job, role, "batch", {"steps": len(steps), "ran": len(results),
                               "failed": sum(1 for r in results if not r["ok"])})
    return {"steps": len(steps), "results": results}


def operate(role, job, action, args):
    if action == "batch":
        # Authorised per step rather than as a whole: a batch grants nothing.
        return run_batch(role, job, args)
    if action not in PERMISSIONS[role] and action != "context":
        event(job, role, "denied", {"action": action})
        raise PermissionError(f"{action} is unavailable to {role}")
    with database() as db:
        state = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()
    if (ROOT / "PAUSED").exists() or (state and state["status"] == "cancelled"):
        raise RuntimeError("Pilot operation stopped by pause/cancellation")
    if action == "buzz":
        result = use_buzz(role, job, args)
    elif action == "context":
        from context import access
        result = access(job, args)
    elif action == "read":
        text = safe_path(args["path"]).read_text()
        offset, limit = args.get("offset", 0), args.get("limit", 24000)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 24000:
            raise ValueError("Read offset must be nonnegative; limit must be 1..24000 characters")
        end = min(len(text), offset + limit)
        result = {"path": args["path"], "content": text[offset:end], "offset": offset,
                  "end": end, "total_chars": len(text), "truncated": end < len(text),
                  "next_offset": end if end < len(text) else None,
                  "sha256": hashlib.sha256(text.encode()).hexdigest()}
    elif action == "write":
        path = safe_path(args["path"])
        if "old_text" in args or "new_text" in args:
            if "content" in args:
                raise ValueError("Choose replacement or complete content, not both")
            # A bare KeyError here reached the agent as the word "KeyError" and
            # nothing else, so it retried the same malformed call until its
            # iteration budget died. An error an agent cannot act on is a defect.
            missing = [k for k in ("old_text", "new_text") if k not in args]
            if missing:
                raise ValueError(
                    f"Replacement needs both old_text and new_text; falta {missing}. "
                    "Para escribir el fichero entero usa 'content' en su lugar."
                )
            old, new = args["old_text"], args["new_text"]
            text = path.read_text()
            if not isinstance(old, str) or not old or text.count(old) != 1 or not isinstance(new, str):
                raise ValueError("Replacement requires exactly one matching nonempty old_text")
            text = text.replace(old, new, 1)
        else:
            text = args["content"]
        if len(text) > 128000:
            raise ValueError("Artifact too large")
        from design_guard import before_write, record
        design_receipt = before_write(role, job, args["path"], text)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        record(job, design_receipt)
        result = {"path": args["path"], "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        if design_receipt:
            result["design_foundation"] = design_receipt
    elif action == "remember":
        if args["kind"] not in {"belief", "question", "idea", "experience", "skill", "report"}:
            raise ValueError("Notebook kind must be belief, question, idea, experience, skill, or report")
        evidence = args.get("evidence")
        if not isinstance(evidence, list) or not evidence or any(not isinstance(v, str) or not v for v in evidence):
            raise ValueError("Provenance required")
        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM notebook WHERE id=?", (args["id"],)).fetchone()
            if old and old["kind"] != args["kind"]:
                raise ValueError("Notebook entry kind is immutable; use a new id")
            if "restore_revision" in args:
                if role not in {"maestro", "reviewer"} or not old:
                    raise PermissionError("Only maestro/reviewer can restore an existing entry")
                saved = db.execute("SELECT body FROM notebook_history WHERE id=? AND revision=?",
                                   (args["id"], args["restore_revision"])).fetchone()
                if not saved:
                    raise ValueError("Unknown historical revision")
                body = json.loads(saved["body"])
                body["restored_from"] = args["restore_revision"]
                body["restoration_evidence"] = evidence
            else:
                body = {"text": args["text"], "evidence": evidence, "status": args.get("status", "candidate")}
                if body["status"] not in {"candidate", "supported", "rejected", "retired"}:
                    raise ValueError("Notebook status is candidate, supported, rejected, or retired; none grants policy authority")
                if args["kind"] == "skill" and body["status"] == "supported":
                    raise PermissionError("Skills remain candidates until independent evaluation; self-promotion is unavailable")
            revision = old["revision"] + 1 if old else 1
            if old:
                db.execute("INSERT INTO notebook_history VALUES(?,?,?,?)", (old["id"], old["revision"], old["body"], old["updated"]))
            db.execute("INSERT OR REPLACE INTO notebook VALUES(?,?,?,?,?,?)", (args["id"], "autonomy-lab", args["kind"], json.dumps(body), revision, time.time()))
        result = {"id": args["id"], "revision": revision}
    elif action == "recall":
        with database() as db:
            if args.get("id"):
                result = [dict(r) for r in db.execute("SELECT * FROM notebook WHERE project='autonomy-lab' AND id=?", (args["id"],))]
                if args.get("history") and result:
                    result[0]["history"] = [dict(r) for r in db.execute("SELECT revision,body,updated FROM notebook_history WHERE id=? ORDER BY revision", (args["id"],))]
            else:
                result = [dict(r) for r in db.execute("SELECT * FROM notebook WHERE project='autonomy-lab' ORDER BY updated DESC LIMIT 40")]
    elif action == "delegate":
        if job.startswith("synthesis-"):
            raise PermissionError("Final synthesis cannot delegate new work")
        if args["role"] == "maestro":
            raise PermissionError("Recursive supervisor delegation is outside this pilot budget")
        result = {"job": enqueue(args["role"], args["prompt"], args["id"], parent=job, depends_on=args.get("depends_on"))}
    elif action == "results":
        with database() as db:
            result = [dict(r) for r in db.execute("""SELECT id,role,status,result FROM jobs
                WHERE parent=? OR id IN (SELECT prerequisite FROM job_dependencies WHERE job=?)
                ORDER BY created,id""", (job, job))]
    elif action == "linear":
        result = asyncio.run(linear_project())
    elif action == "railway":
        result = railway_logs()
    elif action == "fetch":
        url = args["url"]
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in PUBLIC_HOSTS or parsed.port not in (None, 443):
            raise PermissionError("Source outside public research allowlist")
        # Reject redirects before following them, including redirects to private hosts.
        import urllib.request
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                raise PermissionError("Redirect requires explicit source approval")
        with urllib.request.build_opener(NoRedirect).open(Request(url, headers={"User-Agent": "BuzzAutonomyPilot/1.0"}), timeout=35) as response:
            raw = response.read(600000)
        class Text(HTMLParser):
            def __init__(self):
                super().__init__(); self.parts = []
            def handle_data(self, data):
                self.parts.append(data)
        parser = Text(); parser.feed(raw.decode("utf-8", errors="replace"))
        full_text = " ".join(parser.parts)
        result = {"url": url, "sha256": hashlib.sha256(raw).hexdigest(), "text": full_text[:28000],
                  "truncated": len(full_text) > 28000 or len(raw) == 600000,
                  "access_scope": "excerpt" if len(full_text) > 28000 else "retrieved page"}
    elif action == "browser":
        # Either a local artifact under the pilot's own directory, or the app
        # running on this machine. Anything else is refused here rather than in
        # the driver, so the boundary is visible where the permission lives.
        target = args.get("url") or args.get("path")
        if isinstance(target, str) and target.startswith(("http://localhost", "http://127.0.0.1")):
            path = target
        elif "url" in args:
            raise PermissionError(
                "El navegador solo alcanza este ordenador: usa http://localhost:<puerto>. "
                "No es una ventana a internet."
            )
        else:
            path = safe_path(args["path"])
        steps = args.get("steps", [])
        if not isinstance(steps, list) or len(steps) > 24:
            raise ValueError("Browser accepts at most 24 steps; split independent scenarios into separate calls")
        r = subprocess.run(["rtk", "proxy", "node", str(REPO / "experiments/buzz-autonomy/browser.cjs"), str(path), str(ROOT / "artifacts"), json.dumps(args.get("steps", []))], capture_output=True, text=True, timeout=55)
        if r.returncode:
            raise RuntimeError(r.stderr[:1200])
        result = json.loads(r.stdout)
    else:
        raise ValueError("Unknown action")
    event(job, role, action, {"args": args, "result": result})
    return result


# How many times the same call may fail the same way before the pilot stops
# letting the agent spend its budget on it. `tower-diseno` burned all 16
# iterations repeating one rejected write: the model was not stuck because it
# was weak, it was stuck because nothing ever told it the door was locked.
NUDGE_AFTER = 3
REFUSE_AFTER = 6
_REPEATS: dict[tuple[str, str, str], int] = {}

NUDGE = (
    " — Ya has fallado {n} veces con este mismo error. Deja de reintentar: "
    "cambia de enfoque. Reduce el alcance, prueba otra ruta, o informa de que "
    "esta vía está cerrada y por qué. Repetir la misma llamada gasta tu "
    "presupuesto sin acercarte al objetivo."
)
REFUSAL = (
    "Vía cerrada: esta acción ha fallado {n} veces con el mismo error y queda "
    "bloqueada para este encargo. No la reintentes. Entrega lo que tengas, di "
    "explícitamente qué no pudiste hacer y cuál es el obstáculo, para que otro "
    "compañero pueda intentarlo por otro camino."
)


def repetition(job: str, action: str, signature: str) -> int:
    """Count consecutive identical failures, so a stuck loop becomes visible."""
    key = (job, action or "", signature)
    if len(_REPEATS) > 2000:  # bounded: a long-lived process must not grow
        _REPEATS.clear()
    _REPEATS[key] = _REPEATS.get(key, 0) + 1
    return _REPEATS[key]


def register(role, job):
    from tools.registry import registry
    from toolsets import TOOLSETS
    name = "pilot_" + role
    PERMISSIONS[role].add("context")
    schema = {"name": "pilot", "description": "Execute a scoped operation. Available actions: " + ", ".join(sorted(PERMISSIONS[role])) + ", batch. batch: steps (array of {action,args}, max 12) — runs several operations in ONE turn instead of one per turn. Prefer it whenever the next operations do not depend on reading the previous result: three reads and a write cost one turn batched, four separately. Each step is permission-checked exactly as if called alone; batch and delegate cannot be nested inside it. A failing step stops the batch and returns everything already done." + ". read: path, optional offset/limit (characters, max 24000); follow next_offset until truncated=false before claiming full inspection. write: path,content OR path,old_text,new_text (exactly one match; prefer small edits to rewriting large files). remember: id,kind (belief|question|idea|experience|skill|report),text,evidence(array),status(candidate|supported|rejected|retired). Skills cannot self-promote to supported. Maestro/reviewer can restore an existing entry with id,kind,restore_revision,evidence instead of text. recall: optional id,history=true. delegate: id,role,prompt, optional depends_on (list of previously enqueued job IDs). Maximum 14 children; no recursive maestro. fetch: url. browser: path,steps(maximum 24; each call starts fresh; array of {action:click|fill|text|inspect|select|press,selector,value?}). buzz: command,subcommand, optional args (array of strings) — run a READ-ONLY Buzz command and see what the product actually does: channels/messages/projects/issues/notes/feed/users/workflows/canvas/reactions/mem. A command that fails is a finding, not an accident: it is reported to you, not hidden. results/linear/railway: no args.", "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": sorted(PERMISSIONS[role] | {"batch"})}, "args": {"type": "object"}}, "required": ["action", "args"]}}
    def handler(params, **kwargs):
        from inbound import ACTIVE_JOB
        current_job = ACTIVE_JOB.get() or job
        try:
            # A missing key here surfaced to the agent as the word "KeyError"
            # and the character `'args'`, which says nothing about the shape it
            # should have sent. One design turn repeated that same malformed
            # call twelve times. Name the expected envelope instead.
            if "action" not in params or "args" not in params:
                raise ValueError(
                    "Llamada mal formada: la herramienta espera "
                    '{"action": "<acción>", "args": {...}} y faltan '
                    f"{[k for k in ('action', 'args') if k not in params]}. "
                    'Ejemplo: {"action": "write", "args": {"path": "x.html", "content": "..."}}'
                )
            return json.dumps(operate(role, current_job, params["action"], params["args"]), ensure_ascii=False)
        except Exception as exc:
            action = params.get("action")
            message = str(exc)[:500]
            # The signature is type + message, not type alone: two different
            # PermissionErrors are two different obstacles and must not be
            # counted as one loop.
            times = repetition(current_job, action, f"{type(exc).__name__}:{message}")
            event(current_job, role, "tool_error", {
                "action": action, "error": type(exc).__name__,
                "message": message, "repeat": times,
            })
            if times >= REFUSE_AFTER:
                return json.dumps({"error": "Blocked",
                                   "message": REFUSAL.format(n=times) + f" Último error: {message}"})
            if times >= NUDGE_AFTER:
                message += NUDGE.format(n=times)
            return json.dumps({"error": type(exc).__name__, "message": message})
    registry.register("pilot", name, schema, handler, override=True)
    TOOLSETS[name] = {"description": "Scoped pilot capabilities", "tools": ["pilot"]}
    return name
