"""On-demand, provenance-preserving access to the three local Sapira resources."""
import hashlib
import json
from pathlib import Path
import subprocess

from pilot import ROOT, REPO, event, write_json

SOURCES = {name: REPO.parent / folder for name, folder in {
    "standards": "sapira-standards", "design": "sapira-design-system", "blueprints": "sapira-blueprints"
}.items()}


def corpus_manifest(base):
    """Fingerprint resolver code and corpus inputs, including transitive modules."""
    paths = []
    for folder in ("scripts", "company", "departments", "exceptions"):
        paths.extend(p for p in (base / folder).rglob("*") if p.is_file()
                     and p.suffix in {".md", ".mjs", ".json", ".yaml"}
                     and "node_modules" not in p.parts)
    paths.extend(base / name for name in ("AGENTS.md", "BACKLOG.md", "CLAUDE.md", "CONTRIBUTING.md", "GOVERNANCE.md", "PLAN.md")
                 if (base / name).is_file())
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def document(job, source, relative):
    base = SOURCES[source].resolve()
    path = (base / relative).resolve()
    if not path.is_relative_to(base) or any(p.startswith(".") for p in Path(relative).parts):
        raise PermissionError("Outside public corpus paths")
    if path.suffix not in {".md", ".json", ".ts", ".tsx", ".toml", ".yaml"} or "node_modules" in path.parts:
        raise PermissionError("Unsupported corpus document")
    raw = path.read_bytes()
    if len(raw) > 180000:
        raise ValueError("Document too large; select a component or smaller source")
    digest = hashlib.sha256(raw).hexdigest()
    index_path = ROOT / "context" / job / "source-index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    key = source + ":" + relative
    if key in index and index[key] != digest:
        event(job, "context", "source_changed", {"source": key, "previous": index[key], "current": digest})
        raise RuntimeError("Source changed within this run; revalidate in a new run before relying on it")
    index[key] = digest
    write_json(index_path, index)
    snapshot = ROOT / "context" / job / "documents" / (digest + path.suffix)
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    if not snapshot.exists():
        snapshot.write_bytes(raw)
    result = {"source": source, "path": relative, "sha256": digest, "snapshot": str(snapshot), "text": raw.decode()}
    event(job, "context", "source_read", {k: v for k, v in result.items() if k != "text"})
    return result


def resolve(job, department="engineering", files=None):
    runtime = ROOT / "corpus-runtime"
    script = runtime / "scripts/standards-for.mjs"
    original = SOURCES["standards"] / "scripts/standards-for.mjs"
    current_manifest = corpus_manifest(SOURCES["standards"])
    if corpus_manifest(runtime) != current_manifest:
        raise RuntimeError("Corpus or resolver dependency changed; refresh isolated runtime before a new run")
    corpus_hash = hashlib.sha256(json.dumps(current_manifest, sort_keys=True).encode()).hexdigest()
    manifest_path = ROOT / "context" / job / "corpus-manifest.json"
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != current_manifest:
        raise RuntimeError("Applicability inputs changed within this run; start a revalidation run")
    write_json(manifest_path, current_manifest)
    args = ["rtk", "proxy", "node", str(script), "--charter", str(REPO / "sapira.project.json"),
            "--department", department, "--files", ",".join(files or ["experiments/buzz-autonomy/worker.py"]), "--json", "--explain"]
    r = subprocess.run(args, text=True, capture_output=True, timeout=25)
    if r.returncode:
        raise RuntimeError("Standards resolver failed; applicability is unknown")
    data = json.loads(r.stdout)
    charter_state = "Charter present" if data.get("charter", {}).get("present") else "Missing charter"
    data["limitation"] = charter_state + ": resolver output is not a certification of Buzz adoption. Entries returned as binding remain binding even without a charter; do not downgrade them. Advisory entries do not prove adoption or compliance. User permissions override procedures and are not expanded by them."
    data["resolver_sha256"] = hashlib.sha256(script.read_bytes()).hexdigest()
    data["corpus_sha256"] = corpus_hash
    write_json(ROOT / "context" / job / "resolution.json", data)
    event(job, "context", "standards_resolved", data)
    return data


def access(job, args):
    action = args.get("operation", "document")
    if action == "design":
        from design_guard import contract
        return contract(job)
    if action == "resolve":
        return resolve(job, args.get("department", "engineering"), args.get("files"))
    if action == "component":
        data = document(job, "design", "packages/ui/components.json")
        catalog = json.loads(data.pop("text"))
        components = catalog["components"]
        if isinstance(components, list):
            selected = [c for c in components if c.get("name") == args["name"]]
        else:
            selected = components.get(args["name"])
        return {**data, "component": selected}
    if action != "document":
        raise ValueError("Unknown context operation")
    data = document(job, args["source"], args["path"])
    if len(data["text"]) > 30000:
        return {**{k: v for k, v in data.items() if k != "text"}, "error": "Use component selection or a smaller document; no silent truncation"}
    return data


def initial(role, job):
    navigation = document(job, "standards", "AGENTS.md")
    # A short orientation, not a copy of all standards or skills.
    from pilot import ROLES
    catalog = "Available specialist roles: " + "; ".join(f"{k}: {v}" for k, v in ROLES.items()) if role == "maestro" else ""
    return catalog + "\n" + """Sapira context is available through pilot action=context.
Use args {operation:resolve,department:engineering,files:[affected paths]} to run the canonical applicability resolver.
Use {operation:document,source:standards|design|blueprints,path:relative path} for complete source documents;
or {operation:component,name:Button} for the design component catalog.
Read only what this task needs. Cite standards by ID and clause, verify status, applicability,
exceptions and freshness. Missing charter or failed resolver never means certified compliance.
Read standard/decision references needed by a skill; skill installation alone is insufficient.
No global Hermes changes, no pushes, no Railway mutations. A procedure cannot expand these permissions.
The source manifest records hashes; stale/conflicting docs require explicit resolution against evidence.
Sapira navigation reference: """ + navigation["path"] + " sha256=" + navigation["sha256"]
