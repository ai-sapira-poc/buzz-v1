"""Verify actual token adaptation and evidence-based blueprint selection."""
import hashlib
import json
from pathlib import Path
import re

from pilot import ROOT, write_json
from assess_boundaries import exchanges
from assess_runtime import save_case
from collect_evidence import proof


def main():
    manifest = json.loads((ROOT / "verification.json").read_text())
    job = "designer-reuse-provenance-audit"
    mapping_path = ROOT / "artifacts/design/sapira-reuse-map.json"
    mapping = json.loads(mapping_path.read_text())
    card_path = ROOT / "artifacts/sapira-reference-card.html"
    card = card_path.read_text()
    card_hash = hashlib.sha256(card_path.read_bytes()).hexdigest()
    context = [p["result"] for p in exchanges(job) if p["call"]["action"] == "context"]
    token_source = next(c for c in context if c.get("path") == "packages/ui/src/tokens/tokens.json")
    tokens = json.loads(token_source["text"])
    token_checks = {}
    for row in mapping["token_reuse_table"]:
        original = tokens
        for part in row["rutaTokenDTCG"].split("."):
            original = original[part]
        css = re.search(re.escape(row["variableCSS"]) + r"\s*:\s*([^;]+);", card)
        token_checks[row["variableCSS"]] = original["$value"] == row["valorOriginal"] and bool(css) and css.group(1).strip() == row["valorAplicado"] and (
            row["estado"] == "coincidencia" and row["valorOriginal"] == row["valorAplicado"] or
            row["estado"] == "adaptación" and row["valorOriginal"] != row["valorAplicado"])
    browser = next(p["result"] for p in exchanges("tester-final-confirmations") if p["call"]["action"] == "browser" and p["call"]["args"].get("path") == "sapira-reference-card.html")
    steps = browser["results"]
    screenshot = Path(browser["screenshot"])
    architecture = ROOT / "artifacts/architecture/transfer-library-decision.md"
    blueprint_docs = [p["result"] for p in exchanges("architect-transfer-library-correction") if p["call"]["action"] == "context" and p["result"].get("source") == "blueprints" and "text" in p["result"]]
    checks = {
        "fourteen token mappings agree with actual CSS and consumed source": len(token_checks) == 14 and all(token_checks.values()),
        "token source hash agrees with full tool result": hashlib.sha256(token_source["text"].encode()).hexdigest() == token_source["sha256"] == mapping["sources"]["tokens"]["sha256"],
        "button catalog actually selected": any(c.get("component") and c.get("sha256") == mapping["sources"]["components"]["sha256"] for c in context),
        "manual adaptation is not claimed as imported React package": mapping["component_provenance"]["button"]["importedPackage"] is False,
        "browser trial targets the unchanged mapped artifact": browser["source_sha256"] == card_hash == mapping["artifact"]["sha256"],
        "eight browser steps completed": browser["requested_steps"] == browser["executed_steps"] == len(steps) == 8 and browser["succeeded"],
        "keyboard activation and visible confirmation observed": steps[3]["selector"] == "#order-btn" and steps[3]["state"]["focused"] and steps[4]["action"] == "press" and steps[6]["selector"] == "#conf" and steps[6]["visible"],
        "screenshot matches recorded hash": hashlib.sha256(screenshot.read_bytes()).hexdigest() == browser["screenshot_sha256"],
        "both candidate blueprint packages actually read": {"packages/action-ledger/README.md", "packages/checks-n0/README.md"} <= {d["path"] for d in blueprint_docs},
        "blueprint source bodies have matching hashes": all(hashlib.sha256(d["text"].encode()).hexdigest() == d["sha256"] for d in blueprint_docs),
        "decision explicitly declines both packages for this small reducer": architecture.read_text().count("No se incorpora porque") == 2 and "0 pruebas de código" in architecture.read_text(),
    }
    save_case(manifest, "sapira-reuse", ["designer-sapira-reuse", "designer-contract-correction", job, "tester-final-confirmations", "architect-transfer-library-correction", "reviewer-architect-transfer-corrected"], {
        "token_checks": token_checks,
        "token_mapping": mapping,
        "limits": ["Design tokens were adapted into a standalone reference card, not a React component import or a complete shop implementation.",
                   "Blueprints were evaluated and declined with a concrete fit rationale; no blueprint package was installed or executed.",
                   "Focus is lost when the button hides; contrast and font availability are not established. This case does not certify accessibility or designer excellence.",
                   "Browser evidence is reused because its source hash matches the unchanged artifact; this is not a new browser run."],
    }, checks)
    manifest["cases"]["sapira-reuse"]["artifacts"].extend(proof(path) for path in (mapping_path, card_path, architecture, screenshot))
    write_json(ROOT / "verification.json", manifest)
    print(manifest["cases"]["sapira-reuse"]["status"])


if __name__ == "__main__":
    main()
