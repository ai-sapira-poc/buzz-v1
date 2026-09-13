"""Assess actual canonical resolution and consumption of two Sapira standards."""
import hashlib
import json
import re

from pilot import ROOT, write_json
from collect_evidence import proof
from assess_runtime import events, save_case


def prose(text):
    """Compare clause wording across Markdown links, wrapping and punctuation."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    return " ".join(re.findall(r"\w+", text))


def main():
    job = "architect-sapira-applicability"
    calls = [e["data"] for e in events(job, "context")]
    resolved = next(c["result"] for c in calls if c["args"].get("operation") == "resolve")
    docs = {c["result"]["path"]: c["result"] for c in calls if c["args"].get("operation") == "document"}
    audit_path = ROOT / "artifacts/governance/sapira-applicability-audit.json"
    audit = json.loads(audit_path.read_text())
    standards = {s["id"]: s for s in audit["standards"]}
    source_checks = {}
    for standard in standards.values():
        doc = docs[standard["path"]]
        source_checks[standard["id"] + " complete text received with correct hash"] = hashlib.sha256(doc["text"].encode()).hexdigest() == doc["sha256"]
        source_checks[standard["id"] + " status matches source"] = "status: " + standard["status"] in doc["text"]
        source_checks[standard["id"] + " review date matches source"] = "review_by: " + standard["review_by"] in doc["text"]
        source_checks[standard["id"] + " exception clause wording matches source"] = prose(standard["exception_clause"]) in prose(doc["text"])
    checks = {
        **source_checks,
        "canonical resolver and corpus hashes preserved": all(audit["hashes"][key] == resolved[key] for key in ("resolver_sha256", "corpus_sha256")),
        "missing charter reported without inventing adoption": not resolved["charter"]["present"] and audit["charter"]["adopted"] is None,
        "secrets standard stays binding": standards["GEN-STD-0001"]["role"] == "binding" and any(s["id"] == "GEN-STD-0001" for s in resolved["binding"]),
        "experimental document standard stays advisory": standards["GEN-STD-0002"]["role"] == "advisory" and any(s["id"] == "GEN-STD-0002" for s in resolved["advisory"]),
        "no exception to secrets standard fabricated": standards["GEN-STD-0001"]["exceptions_allowed"] is False,
    }
    manifest = json.loads((ROOT / "verification.json").read_text())
    save_case(manifest, "sapira-applicability", [job], {
        "resolution": resolved, "audit": audit, "scope": "Two actual standards and the specified files; no corporate certification"}, checks)
    manifest["cases"]["sapira-applicability"]["artifacts"].append(proof(audit_path))
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps(checks))


if __name__ == "__main__":
    main()
