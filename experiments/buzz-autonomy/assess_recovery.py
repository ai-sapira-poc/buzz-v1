"""Verify recovery of a real incomplete conversation without replaying its note write."""
import json

from pilot import ROOT, database, write_json
from assess_runtime import events, save_case
from collect_evidence import proof


def main():
    job = "scheduled-learning-live-001"
    previous_path = ROOT / "runs/attempts" / job / "1.json"
    previous = json.loads(previous_path.read_text())
    current = json.loads((ROOT / "runs" / (job + ".json")).read_text())
    retry = events(job, "retry_from")[0]
    before_notes = [e for e in events(job, "remember") if e["seq"] < retry["seq"]]
    after_notes = [e for e in events(job, "remember") if e["seq"] > retry["seq"]]
    reads = [e for e in events(job, "recall") if e["seq"] > retry["seq"]]
    note_id = "learning-question-substitution-001"
    with database() as db:
        state = dict(db.execute("SELECT status,attempts FROM jobs WHERE id=?", (job,)).fetchone())
    checks = {
        "first forced summary remains incomplete in immutable attempt archive": previous.get("completed") is False and previous.get("turn_exit_reason") == "max_iterations_reached(12/12)",
        "retry links the preserved previous attempt": retry["data"]["previous_trace"] == str(previous_path.relative_to(ROOT)) and retry["data"]["attempt"] == 2,
        "new conversation receives recovery context": any("This is a retry" in str(m.get("content", "")) for m in current["messages"]),
        "prior note was actually created before failure": any(e["data"]["args"].get("id") == note_id for e in before_notes),
        "retry retrieved rather than rewrote prior note": any(n["id"] == note_id for e in reads for n in e["data"]["result"]) and not after_notes,
        "missing deliverable written on retry": any(e["seq"] > retry["seq"] and e["data"]["args"].get("path") == "scheduled-learning.md" for e in events(job, "write")),
        "completed within two attempts": state == {"status": "done", "attempts": 2} and current.get("completed") is True,
    }
    manifest = json.loads((ROOT / "verification.json").read_text())
    save_case(manifest, "failure-recovery", [job], {
        "scope": "Operator-triggered retry, not automatic retry policy. Turn cap was raised from 12 to 16 after diagnosing the incomplete result.",
        "retry": retry, "prior_note_writes": before_notes, "state": state}, checks)
    manifest["cases"]["failure-recovery"]["artifacts"].extend([proof(previous_path), proof(ROOT / "artifacts/scheduled-learning.md")])
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps(checks))


if __name__ == "__main__":
    main()
