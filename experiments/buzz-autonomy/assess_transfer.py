"""Audit a held-out paired trial; completing evaluation does not imply improvement."""
import hashlib
import json
import sqlite3

from pilot import ROOT, write_json
from collect_evidence import proof
from assess_runtime import save_case


def load_trial(condition, job):
    root = ROOT / "evaluator/trials" / condition
    with sqlite3.connect(root / "pilot.db") as db:
        db.row_factory = sqlite3.Row
        task = dict(db.execute("SELECT id,role,prompt,status,created FROM jobs WHERE id=?", (job,)).fetchone())
        recalled = json.loads(db.execute("SELECT data FROM events WHERE job=? AND action='recall' ORDER BY seq LIMIT 1", (job,)).fetchone()[0])["result"]
    trace = json.loads((root / "runs" / (job + ".json")).read_text())
    return root, task, recalled, trace


def main():
    design = json.loads((ROOT / "evaluator/trial-design.json").read_text())
    a, b = load_trial("without-skill", "transfer-product-a"), load_trial("with-skill", "transfer-product-b")
    def notes(rows):
        return sorted((r["id"], r["body"], r["revision"]) for r in rows if r["kind"] != "skill")
    skill_a = [r for r in a[2] if r["kind"] == "skill"]
    skill_b = [r for r in b[2] if r["kind"] == "skill"]
    observed = {
        "design": design,
        "input_tokens": {"without_skill": a[3]["input_tokens"], "with_skill": b[3]["input_tokens"]},
        "total_tokens": {"without_skill": a[3]["total_tokens"], "with_skill": b[3]["total_tokens"]},
        "input_token_change_percent": round(100 * (b[3]["input_tokens"] / a[3]["input_tokens"] - 1), 2),
        "finding": "Independent review found no clear winner. No quality gain demonstrated in this pair; treatment used more tokens.",
        "limits": ["One synthetic pair, not a causal or generalization estimate.",
                   "Both conditions retained the same non-skill learned notes; only incremental skill availability was compared.",
                   "Older traces do not record configured turn caps, so equal caps are not independently verified.",
                   "The artifacts propose experiments and transaction rules; the sticker shop itself was not implemented or browser-tested."]}
    checks = {
        "same prompt and innovation role": a[1]["prompt"] == b[1]["prompt"] and a[1]["role"] == b[1]["role"] == "innovation",
        "same released fixture bytes": all(hashlib.sha256((t[0] / "artifacts/brief.md").read_bytes()).hexdigest() == design["fixture_sha256"] for t in (a, b)),
        "both jobs began after fixture release": all(t[1]["created"] >= design["released_at"] for t in (a, b)),
        "non-skill memory actually recalled is identical": notes(a[2]) == notes(b[2]),
        "only treatment recalled the frozen candidate": not skill_a and len(skill_b) == 1 and skill_b[0]["revision"] == design["skill_revision"] == 2,
        "treatment skill artifact matches frozen hash": hashlib.sha256((b[0] / "artifacts/skills/product-learning-candidate.md").read_bytes()).hexdigest() == design["skill_sha256"],
        "both completed via required route": all(t[3]["completed"] and t[3]["model"] == pilot.MODEL and t[3]["base_url"] == "http://localhost:20128/v1" for t in (a, b)),
    }
    manifest = json.loads((ROOT / "verification.json").read_text())
    save_case(manifest, "heldout-transfer", ["transfer-product-a", "transfer-product-b", "analyst-transfer-paired-review"], observed, checks)
    manifest["cases"]["heldout-transfer"]["artifacts"].extend(proof(ROOT / "artifacts" / path) for path in (
        "transfer/answer-a.md", "transfer/answer-b.md", "transfer/brief.json", "reviews/transfer-paired-review.md"))
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps({"status": manifest["cases"]["heldout-transfer"]["status"], "observed": observed}))


if __name__ == "__main__":
    main()
