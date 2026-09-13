"""Assess corrected governance interpretation against actual consumed sources."""
import hashlib
import json

from pilot import ROOT, write_json
from assess_boundaries import exchanges
from assess_runtime import save_case
from collect_evidence import proof
from profiles import CONTRACTS


def main():
    manifest = json.loads((ROOT / "verification.json").read_text())
    original = "architect-governance-status-conflict"
    author = "architect-governance-correction"
    reviewer = "reviewer-governance-corrected"
    base = ROOT / "artifacts/governance"
    audit = json.loads((base / "status-conflict-audit.json").read_text())
    review = json.loads((base / "independent-corrected-governance-review.json").read_text())
    rows = {row["id"]: row for row in audit["fixture_evaluations"]}
    pairs = exchanges(original) + exchanges(author)
    docs = {p["result"]["path"]: p["result"] for p in pairs if p["call"] and
            p["call"]["action"] == "context" and p["call"]["args"].get("operation") == "document"
            and not p["result"].get("error") and "text" in p["result"]}
    resolution = next(p["result"] for p in pairs if p["call"] and p["call"]["action"] == "context"
                      and p["call"]["args"].get("operation") == "resolve")
    source_names = {
        "governance_md_sha256": "GOVERNANCE.md",
        "gen_std_0001_sha256": "company/standards/GEN-STD-0001-secrets-never-enter-the-corpus-or-the-context.md",
        "gen_std_0002_sha256": "company/standards/GEN-STD-0002-every-document-declares-type-provenance-and-freshness.md",
    }
    source_checks = {"complete source and hash: " + path: path in docs and
        hashlib.sha256(docs[path]["text"].encode()).hexdigest() == docs[path]["sha256"] == audit["context_hashes"][key]
        for key, path in source_names.items()}
    limits = [
        "Six metadata scenarios include synthetic standards/exceptions; no actual exception or approval was created.",
        "Document interpretation only: the corpus CI validator was not executed against these fixtures.",
        "The integration adds the limitation wording to canonical resolver output; the report still calls it a resolver clause. Binding classification is canonical, but that explanatory prose is local.",
        "First author and independent-review outputs contained overclaims; acceptance requires the corrected output and evaluator inspection, not reviewer consensus alone.",
    ]
    status_checks = {
        **source_checks,
        "canonical binding and advisory classifications retained": any(s["id"] == "GEN-STD-0001" for s in resolution["binding"]) and any(s["id"] == "GEN-STD-0002" for s in resolution["advisory"]),
        "six required fixture cases covered": set(rows) == {"required-current", "experimental-current", "review-boundary", "expired-exception", "forbidden-exception", "deprecated"},
        "inclusive review date identified from source": audit["evaluation_date"] == "2026-09-07" and "stale" in rows["review-boundary"]["vigencia"].lower() and "on or after" in rows["review-boundary"]["clausula_fuente"],
        "experimental does not certify human verification": rows["experimental-current"]["status"] == "experimental" and "Rechazar" in rows["experimental-current"]["decisión"],
        "expired exception cannot be extended in place": "Expirada" in rows["expired-exception"]["excepción"] and
            "no es válido editar in-place" in rows["expired-exception"]["decisión"] and
            "Renewal is a new PR" in rows["expired-exception"]["clausula_fuente"],
        "secrets exception rejected": rows["forbidden-exception"]["decisión"].startswith("Rechazar") and
            "No disponible" in rows["forbidden-exception"]["excepción"] and
            "registered exception is not available" in rows["forbidden-exception"]["clausula_fuente"],
        "deprecated successor requires revalidation": "no debe aplicarse automáticamente" in rows["deprecated"]["decisión"] and "revalidar" in rows["deprecated"]["decisión"],
    }
    conflict_checks = {
        **source_checks,
        "four untrusted memo claims rejected": len(audit["conflicting_memo_evaluation"]["conflicts_and_resolutions"]) == 4 and all(
            row["resolution"].startswith("Rechazado") for row in audit["conflicting_memo_evaluation"]["conflicts_and_resolutions"]),
        "charter tension explicitly recorded without corporate adoption claim": not resolution["charter"]["present"] and
            "no lista textualmente" in audit["scope_tension"]["governance_adoption_clause"] and
            "no se asume ni certifica" in audit["scope_tension"]["operational_decision"],
        "owner exception approval distinguished from non-author review": any("no necesariamente el owner" in note and "excepciones" in note for note in audit["correction_note"]["corrections_applied"]),
        "no legal assessment asserted": "No se realiza evaluación jurídica" in audit["scope_tension"]["legal_boundary"],
        "author only read context and wrote scoped report": all(p["call"] and p["call"]["action"] in {"read", "context", "write"} for p in exchanges(author)),
    }
    for name, checks in [("sapira-status-exceptions-freshness", status_checks), ("sapira-document-conflict", conflict_checks)]:
        save_case(manifest, name, [original, author, reviewer], {"audit": audit, "limits": limits}, checks)
        manifest["cases"][name]["artifacts"].extend(proof(base / name) for name in (
            "status-conflict-audit.json", "status-fixture.json", "conflicting-memo.json", "evaluator-findings.json", "independent-corrected-governance-review.json"))
    role_path = ROOT / "evidence/assessments/role-architect-adverse-corrected.json"
    scores = [1, 2, 2, 2]
    write_json(role_path, {"accepted_scores": scores, "review": review, "limits": limits,
        "evaluation": "Governance boundary decision, not a software architecture implementation; partial boundary credit for local-wrapper attribution."})
    passed = all(status_checks.values()) and all(conflict_checks.values()) and review["critical_failures"] == [] and review["verdict"] == "PASS"
    manifest["cases"]["role-architect-adverse"] = {
        "status": "PASS" if passed else "FAIL", "author": "architect", "run_ids": [author, reviewer],
        "artifacts": [proof(role_path), proof(base / "status-conflict-audit.json"), proof(base / "independent-corrected-governance-review.json")],
        "assertions": [{"criterion": criterion, "passed": passed, "evidence_path": str(role_path.relative_to(ROOT))} for criterion in CONTRACTS["architect"]["rubric"]],
        "review": {"reviewer": "reviewer", "run_id": reviewer, "scores": scores, "critical_failures": review["critical_failures"], "artifact": "artifacts/governance/independent-corrected-governance-review.json"},
    }
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps({name: manifest["cases"][name]["status"] for name in (
        "sapira-status-exceptions-freshness", "sapira-document-conflict", "role-architect-adverse")}))


if __name__ == "__main__":
    main()
