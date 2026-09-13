"""Verify bounded pause, cancellation and one-conversation execution evidence."""
import json

from pilot import ROOT, database, write_json
from assess_runtime import events, save_case
from collect_evidence import proof


def main():
    cancel_path = ROOT / "evidence/assessments/cancellation-live.json"
    budget_path = ROOT / "evidence/assessments/budget-pause-live.json"
    cancelled = json.loads(cancel_path.read_text())
    budget = json.loads(budget_path.read_text())
    job = "control-cancel-live"
    created = events(job, "agent_created")[0]
    requested = events(job, "cancellation_requested")[0]
    stopped = events(job, "stopped")
    reads = events(job, "read")
    with database() as db:
        state = db.execute("SELECT status FROM jobs WHERE id=?", (job,)).fetchone()[0]
        unexpected = db.execute("SELECT count(*) FROM events WHERE job=? AND action IN ('write','remember','delegate','buzz_report') AND at>=?", (job, cancelled["cancel_requested_at"])).fetchone()[0]
    rows = {r["id"]: r for r in budget["jobs_before_cleanup"]}
    checks = {
        "cancel targeted the actual Hermes process": cancelled["pid"] == created["data"]["pid"] and created["data"]["model"] == pilot.MODEL and created["data"]["endpoint"] == "http://localhost:20128/v1",
        "cancellation followed a real tool read": any(r["seq"] == cancelled["read_seq"] and r["at"] <= requested["at"] for r in reads),
        "supervisor acknowledged cancellation and process exit": state == "cancelled" and cancelled["cancelled"] and cancelled["process_absent"] and cancelled["supervisor_joined"] and any(e["data"].get("reason") == "cancelled" for e in stopped),
        "no later artifact or completion published": not cancelled["later_artifact_exists"] and unexpected == 0,
        "pause started no conversations": budget["paused_execution"] == [] and budget["starts_while_paused"] == 0,
        "resume executed exactly one conversation": budget["resumed_execution"] == ["control-budget-first"] and rows["control-budget-first"]["status"] == "done",
        "second queued task stayed unexecuted": rows["control-budget-second"]["status"] == "queued" and rows["control-budget-second"]["attempts"] == 0 and not budget["second_artifact_exists"],
    }
    manifest = json.loads((ROOT / "verification.json").read_text())
    save_case(manifest, "budget-pause-cancel", ["control-budget-first"], {
        "scope": "Cancellation intentionally produces no completed run; negative evidence is the real process/tool ledger. The resumed budget task has a complete Hermes run and signed report.",
        "cancelled": cancelled, "budget": budget, "created": created, "requested": requested, "stopped": stopped}, checks)
    manifest["cases"]["budget-pause-cancel"]["artifacts"].extend([
        proof(cancel_path), proof(budget_path), proof(ROOT / "artifacts/traces/control-cancel-live.json")])
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps(checks))


if __name__ == "__main__":
    main()
