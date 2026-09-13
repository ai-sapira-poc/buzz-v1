"""Collect real run/relay proof without assigning semantic PASS to any scenario."""
import hashlib
import json
import subprocess

from pilot import ROOT, REPO, buzz, config, database, write_json


def proof(path):
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def collect():
    c = config()
    path = ROOT / "verification.json"
    manifest = json.loads(path.read_text())
    relay_events = buzz("editor", ["messages", "get", "--channel", c["channel"], "--limit", "100", "--kinds", "9,40002,45001"])
    by_id = {e["id"]: e for e in relay_events}
    with database() as db:
        receipts = db.execute("SELECT job,role,data FROM events WHERE action='buzz_report' ORDER BY seq").fetchall()
    collected = 0
    for row in receipts:
        run_path = ROOT / "runs" / (row["job"] + ".json")
        if not run_path.exists():
            continue
        run = json.loads(run_path.read_text())
        receipt = json.loads(row["data"])
        if not receipt.get("accepted"):
            continue
        event_id = receipt["event_id"]
        if event_id not in by_id:
            found = buzz("editor", ["messages", "thread", "--channel", c["channel"], "--event", event_id])
            by_id.update({e["id"]: e for e in found})
        relay_event = by_id[event_id]
        if relay_event["pubkey"] != c["identities"][row["role"]]["pubkey"]:
            raise RuntimeError("Report identity mismatch")
        if ["h", c["channel"]] not in [t[:2] for t in relay_event["tags"]]:
            raise RuntimeError("Report channel mismatch")
        verified = subprocess.run(["rtk", "proxy", "node", str(REPO / "experiments/buzz-autonomy/verify_buzz.cjs")],
            input=json.dumps([relay_event]), text=True, capture_output=True, check=True)
        if json.loads(verified.stdout)["verified"] != 1:
            raise RuntimeError("Missing signature verification")
        archive = ROOT / "evidence" / "events" / (event_id + ".json")
        write_json(archive, relay_event)
        manifest["runs"][row["job"]] = {
            "community": c["relay"].replace("wss://", "https://"), "combo": run.get("model"),
            "endpoint": run.get("base_url"), "provider": run.get("provider"), "role": row["role"],
            "pubkey": relay_event["pubkey"],
            "tool_trace": proof(run_path), "buzz_event": proof(archive),
            "signature_verified": True, "completed": run.get("completed"),
            "api_calls": run.get("api_calls"), "input_tokens": run.get("input_tokens"),
            "output_tokens": run.get("output_tokens"),
            "assessment": "Conversation execution evidence only; quality is assessed separately"}
        collected += 1
    write_json(path, manifest)
    return {"archived_run_reports": collected, "case_verdicts_changed": 0}


if __name__ == "__main__":
    print(json.dumps(collect()))
