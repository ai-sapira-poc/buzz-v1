"""Local Buzz/Hermes pilot: state, scoped operations and resource bootstrap.

No credentials are accepted in CLI arguments or written into the repository.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]
# The community directory, not its parent. The parent still holds an older
# config.json pointing at a local relay with a different combo, so defaulting
# there meant any entry point that forgot to export BUZZ_PILOT_HOME silently read
# the wrong community — measured twice: once as a bare KeyError on a missing
# auth_tag, once as a test reading a stale model name. The override still wins
# for anyone deliberately pointing elsewhere.
ROOT = Path(os.environ.get("BUZZ_PILOT_HOME", str(Path.home() / ".local/share/buzz-autonomy-pilot/sapira"))).resolve()
HERMES = Path.home() / ".hermes/hermes-agent"
PYTHON = HERMES / "venv/bin/python"
BUZZ = REPO / "target/debug/buzz"
# Every inference call in this system routes here, on both harnesses. Declared
# once: the combo used to live as a literal in five places, and when it changed
# they drifted apart silently — a verifier still asserting the old name would
# have passed on a run that never used it.
MODEL = "cheap-combo"

ROLES = {
    "maestro": "Coordinate tasks, formulate questions and synthesize evidence. Delegate bounded work; preserve provenance.",
    "research": "Read primary sources, compare claims, identify limitations and revise beliefs using evidence.",
    "product": "Product discovery, innovation and technology strategy: hypotheses, alternatives, acceptance and impact.",
    "designer": "UX/UI and visual design: flows, accessible states and concrete HTML/SVG prototypes.",
    "coder": "Architecture and implementation: create small local artifacts with explicit contracts and checks.",
    "reviewer": "Independent critique and QA: verify artifacts and evidence, including negative cases. Do not invent success.",
    "tester": "Exercise a real browser with scoped browser operations; report observed behavior and evidence.",
    "analyst": "Read integration status and evidence; produce traceable briefings and impact reports.",
    "strategy": "Corporate technology strategy: strategic choices, economics, capabilities and sequencing with explicit assumptions.",
    "innovation": "Discover growth opportunities; design falsifiable experiments, learning goals and stop/scale decisions.",
    "ux": "User research and interaction design: behavioral evidence, user journeys, accessibility and usability risks.",
    "architect": "Assess technical feasibility, boundaries and trade-offs; prefer reversible, minimal architecture.",
    "operations": "Diagnose service behavior using read-only logs; separate observed symptoms from root-cause hypotheses.",
    "editor": "Own Linear product communication in clear Spanish business language: customer problem, strategic impact, decision and measurable outcomes. Never invent ROI or market data.",
}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    tmp.chmod(0o600)
    tmp.replace(path)


def config() -> dict:
    return json.loads((ROOT / "config.json").read_text())


def database() -> sqlite3.Connection:
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(ROOT / "pilot.db", timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, role TEXT NOT NULL, prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', parent TEXT, created REAL NOT NULL,
        result TEXT, attempts INTEGER NOT NULL DEFAULT 0, started REAL);
      CREATE TABLE IF NOT EXISTS notebook (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL,
        body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS notebook_history (
        id TEXT, revision INTEGER, body TEXT, updated REAL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY, job TEXT, role TEXT, action TEXT, data TEXT, at REAL);
      CREATE TABLE IF NOT EXISTS job_dependencies (
        job TEXT, prerequisite TEXT, PRIMARY KEY(job, prerequisite));
      CREATE TABLE IF NOT EXISTS inbound (
        role TEXT, event_id TEXT, job TEXT, status TEXT, created REAL,
        PRIMARY KEY(role,event_id));
    """)
    return db


def event(job: str, role: str, action: str, data: object) -> None:
    with database() as db:
        db.execute("INSERT INTO events(job,role,action,data,at) VALUES(?,?,?,?,?)",
                   (job, role, action, json.dumps(data, ensure_ascii=False), time.time()))


def buzz(role: str, args: list[str]) -> dict | list:
    c = config()
    identity = c["identities"][role]
    env = {**os.environ, "BUZZ_RELAY_URL": c["relay"], "BUZZ_PRIVATE_KEY": identity["secret"]}
    env.pop("BUZZ_AUTH_TAG", None)
    if identity.get("auth_tag"):
        env["BUZZ_AUTH_TAG"] = identity["auth_tag"]
    result = subprocess.run(["rtk", "proxy", str(BUZZ), *args], env=env,
                            text=True, capture_output=True, timeout=35)
    if result.returncode:
        raise RuntimeError(f"Buzz operation failed ({result.returncode}): {result.stderr[:600]}")
    return json.loads(result.stdout)


def enqueue(role: str, prompt: str, key: str, parent: str | None = None, depends_on: list[str] | None = None) -> str:
    if role not in ROLES:
        raise ValueError("Unknown role")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", key) or len(prompt) > 20000:
        raise ValueError("Invalid task size or id")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT role,prompt,parent FROM jobs WHERE id=?", (key,)).fetchone()
        if old and (old["role"], old["prompt"], old["parent"]) != (role, prompt, parent):
            raise ValueError("Idempotency key reused with different payload")
        if parent and not old:
            count = db.execute("SELECT count(*) FROM jobs WHERE parent=?", (parent,)).fetchone()[0]
            if count >= 14:
                raise PermissionError("Delegation budget exhausted (14 children)")
        dependencies = sorted(set(depends_on or []))
        if key in dependencies or len(dependencies) > 14:
            raise ValueError("Invalid dependencies")
        for prerequisite in dependencies:
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", prerequisite):
                raise ValueError("Invalid prerequisite id")
            if not db.execute("SELECT 1 FROM jobs WHERE id=?", (prerequisite,)).fetchone():
                raise ValueError("Enqueue prerequisites first")
        if old:
            previous = sorted(r[0] for r in db.execute("SELECT prerequisite FROM job_dependencies WHERE job=?", (key,)))
            if previous != dependencies:
                raise ValueError("Idempotency key reused with different dependencies")
        db.execute("INSERT OR IGNORE INTO jobs(id,role,prompt,parent,created) VALUES(?,?,?,?,?)",
                   (key, role, prompt, parent, time.time()))
        db.executemany("INSERT OR IGNORE INTO job_dependencies VALUES(?,?)", [(key, prerequisite) for prerequisite in dependencies])
    return key


def safe_path(relative: str, folder: str = "artifacts") -> Path:
    base = (ROOT / folder).resolve()
    p = (base / relative).resolve()
    if not p.is_relative_to(base) or p == base:
        raise PermissionError("Path outside pilot scope")
    return p


def bootstrap() -> None:
    """Create only resources on the local development relay, idempotently."""
    import yaml
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    ROOT.chmod(0o700)
    if not (ROOT / "config.json").exists():
        main_config = Path.home() / ".hermes/config.yaml"
        model = yaml.safe_load(main_config.read_text())["model"]
        c = {"relay": "http://localhost:3000", "model": MODEL,
             "endpoint": "http://localhost:20128/v1", "api_key": model.get("api_key", "not-needed"),
             "identities": {}, "baseline": {"hermes_config_sha256": hashlib.sha256(main_config.read_bytes()).hexdigest()}}
        for role in ["operator", *ROLES]:
            result = subprocess.run(["rtk", "proxy", str(REPO / "target/debug/buzz-admin"), "generate-key"],
                                    text=True, capture_output=True, check=True)
            secret = re.search(r"Secret key:\s*(nsec1[a-z0-9]+|[0-9a-f]{64})", result.stdout, re.I)
            public = re.search(r"(?:Public key|Pubkey).*?([0-9a-f]{64})", result.stdout, re.I)
            if not secret or not public:
                raise RuntimeError("Unexpected key generator format (output suppressed)")
            c["identities"][role] = {"secret": secret.group(1), "pubkey": public.group(1)}
        write_json(ROOT / "config.json", c)
    c = config()
    for role in ["operator", *ROLES]:
        if role in c["identities"]:
            continue
        result = subprocess.run(["rtk", "proxy", str(REPO / "target/debug/buzz-admin"), "generate-key"],
                                text=True, capture_output=True, check=True)
        secret = re.search(r"Secret key:\s*([0-9a-f]{64})", result.stdout, re.I)
        public = re.search(r"(?:Public key|Pubkey).*?([0-9a-f]{64})", result.stdout, re.I)
        if not secret or not public:
            raise RuntimeError("Unexpected key generator format")
        c["identities"][role] = {"secret": secret.group(1), "pubkey": public.group(1)}
        write_json(ROOT / "config.json", c)
    if not c.get("channel"):
        result = buzz("operator", ["channels", "create", "--name", "autonomy-lab", "--type", "stream",
                                   "--visibility", "private", "--description", "Isolated Hermes autonomy pilot"])
        c["channel"] = result.get("channel_id") or result.get("id")
        if not c["channel"]:
            raise RuntimeError(f"Channel response keys: {list(result)}")
        write_json(ROOT / "config.json", c)
    if not c.get("project"):
        result = buzz("operator", ["projects", "create", "autonomy-lab", "--name", "Autonomy Lab",
                                   "--channel", c["channel"], "--visibility", "unlisted"])
        c["project"] = result
        write_json(ROOT / "config.json", c)
    # Provisioning is scoped when asked. Re-running the whole roster rewrites 14
    # already-correct profiles and republishes their profile events into a shared
    # community for no gain; adding roles should touch only the roles added.
    only = [r.strip() for r in os.environ.get("BUZZ_PILOT_ONLY_ROLES", "").split(",") if r.strip()]
    targets = {r: m for r, m in ROLES.items() if not only or r in only}
    if only:
        unknown = sorted(set(only) - set(ROLES))
        if unknown:
            raise ValueError(f"Unknown roles requested: {unknown}")
    for role, mission in targets.items():
        home = ROOT / "profiles" / role
        home.mkdir(parents=True, exist_ok=True, mode=0o700)
        profile = {"model": {"provider": "custom", "default": c["model"],
                   "base_url": c["endpoint"], "api_key": c["api_key"]}, "mcp_servers": {},
                   "memory": {"memory_enabled": False, "user_profile_enabled": False},
                   "skills": {"auto_review": False}}
        (home / "config.yaml").write_text(yaml.safe_dump(profile))
        (home / "config.yaml").chmod(0o600)
        (home / "SOUL.md").write_text(mission + "\n")
        (home / ".no-bundled-skills").touch()
        buzz(role, ["users", "set-profile", "--name", f"Lab {role.title()}", "--about", mission])
        buzz("operator", ["channels", "add-member", "--channel", c["channel"],
                          "--pubkey", c["identities"][role]["pubkey"], "--role", "bot"])
    # User can inspect the private pilot channel from their own desktop identity.
    if os.environ.get("BUZZ_PILOT_VIEWER"):
        c["viewer"] = os.environ["BUZZ_PILOT_VIEWER"]
        write_json(ROOT / "config.json", c)
        buzz("operator", ["channels", "add-member", "--channel", c["channel"],
                          "--pubkey", c["viewer"], "--role", "admin"])
    print(json.dumps({"root": str(ROOT), "channel": c["channel"], "roles": list(ROLES)}))


if __name__ == "__main__":
    bootstrap()
