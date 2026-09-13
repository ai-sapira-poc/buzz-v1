"""Verify live Hermes detection/revalidation on a disposable source fixture."""
import hashlib
import json
from pathlib import Path

from pilot import ROOT, write_json
from context import SOURCES, corpus_manifest
from collect_evidence import proof
from assess_runtime import events, save_case
from assess_boundaries import exchanges


def main():
    before = "research-source-change-detection"
    after = "research-source-change-revalidation"
    first = next(e["data"]["result"] for e in events(before, "context") if e["data"]["args"].get("path") == "fixture-source.md")
    second = next(e["data"]["result"] for e in events(after, "context") if e["data"]["args"].get("path") == "fixture-source.md")
    denial = [p for p in exchanges(before) if isinstance(p["result"], dict) and p["result"].get("error") == "RuntimeError"]
    changed = events(before, "source_changed")
    processes = [events(job, "agent_created")[0]["data"]["pid"] for job in (before, after)]
    reference = json.loads((ROOT / "context/architect-sapira-applicability/corpus-manifest.json").read_text())
    findings = {
        "real hash change detected in the first run": len(changed) == 1 and changed[0]["data"]["previous"] == first["sha256"] and changed[0]["data"]["current"] == second["sha256"],
        "second same-run read rejected by the actual tool": len(denial) == 1 and denial[0]["result"]["message"] == "Source changed within this run; revalidate in a new run before relying on it",
        "denial did not expose replacement content": bool(denial) and "text" not in denial[0]["result"],
        "revalidation used a different Hermes process": processes[0] != processes[1],
        "new run received changed source bytes": first["sha256"] != second["sha256"] and "= 3 cuentos" in first["text"] and "= 2 cuentos" in second["text"],
        "old source snapshot remained intact": Path(first["snapshot"]).read_text() == first["text"],
        "new source snapshot hash verifies": hashlib.sha256(Path(second["snapshot"]).read_bytes()).hexdigest() == second["sha256"],
        "real Sapira corpus matches pre-test manifest": corpus_manifest(SOURCES["standards"]) == reference,
        "new candidate belief persisted": any(e["data"]["args"].get("kind") == "belief" and e["data"]["args"].get("status") == "candidate" and e["data"]["args"].get("evidence") for e in events(after, "remember")),
    }
    manifest = json.loads((ROOT / "verification.json").read_text())
    save_case(manifest, "source-update-revalidation", [before, after], {
        "scope": "Evaluator changed only an isolated simulated source; real Hermes, context guard and Buzz reporting",
        "first_read": first, "second_read": second, "denied": denial, "processes": processes}, findings)
    manifest["cases"]["source-update-revalidation"]["artifacts"].extend([
        proof(ROOT / "artifacts/research/source-change-detection.md"),
        proof(ROOT / "artifacts/research/source-change-revalidation.md")])
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps(findings))


if __name__ == "__main__":
    main()
