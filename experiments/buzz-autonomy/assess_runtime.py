"""Assess specific runtime invariants from actual runs; no professional-quality grading."""
import json
import subprocess
import hashlib

from pilot import ROOT, REPO, config, database, write_json
from collect_evidence import proof
from verify import validate_run


def events(job, action):
    with database() as db:
        return [{**dict(r), "data": json.loads(r["data"])} for r in db.execute(
            "SELECT * FROM events WHERE job=? AND action=? ORDER BY seq", (job, action))]


def save_case(manifest, name, runs, observations, checks):
    for run in runs:
        errors = validate_run(run, manifest["runs"][run], manifest["channel"])
        checks[run + ": real Hermes trace and signed report"] = not errors
        observations[run + ": run errors"] = errors
    path = ROOT / "evidence" / "assessments" / (name + ".json")
    # Retain previous verdicts and their evidence before reassessing a retry.
    if path.exists():
        previous = path.read_bytes()
        archive = path.parent / "history" / name / (hashlib.sha256(previous).hexdigest() + ".json")
        archive.parent.mkdir(parents=True, exist_ok=True)
        if not archive.exists():
            archive.write_bytes(previous)
    write_json(path, {"observations": observations, "checks": checks,
                     "scope": "Only the named runtime invariant; not agent excellence or global autonomy"})
    evidence = proof(path)
    manifest["cases"][name] = {
        "status": "PASS" if all(checks.values()) else "FAIL", "run_ids": runs,
        "artifacts": [evidence],
        "assertions": [{"criterion": key, "passed": value, "evidence_path": evidence["path"]} for key, value in checks.items()]}


def main():
    manifest = json.loads((ROOT / "verification.json").read_text())
    native = "native-8c09c24d9ba1f30dec6c30c72605e5451dd0d43a"
    claimed = events(native, "inbound_claimed")[0]
    signed = claimed["data"]["events"]
    result = subprocess.run(["rtk", "proxy", "node", str(REPO / "experiments/buzz-autonomy/verify_buzz.cjs")],
                            input=json.dumps(signed), text=True, capture_output=True)
    save_case(manifest, "buzz-native-transport", [native], {"inbound": claimed}, {
        "request signature verifies": bool(signed) and result.returncode == 0,
        "request targets the native maestro": all(["p", config()["identities"]["maestro"]["pubkey"]] in [t[:2] for t in e["tags"]] for e in signed),
        "request belongs to the pilot channel": all(["h", config()["channel"]] in [t[:2] for t in e["tags"]] for e in signed),
        "native turn actually delegated": len(events(native, "delegate")) == 2})

    first, second = "strategy-learning-correction", "strategy-unsupported-criticism"
    created_a, created_b = events(first, "agent_created")[0], events(second, "agent_created")[0]
    remembered = next(e for e in events(first, "remember") if e["data"]["args"]["id"] == "strat-belief-001")
    recalled = next(n for e in events(second, "recall") for n in e["data"]["result"] if n["id"] == "strat-belief-001")
    save_case(manifest, "memory-after-restart", [first, second], {
        "first_process": created_a, "second_process": created_b, "write": remembered, "read": recalled}, {
        "distinct real Hermes processes": created_a["data"]["pid"] != created_b["data"]["pid"],
        "same isolated strategy profile": created_a["data"]["profile_home"] == created_b["data"]["profile_home"],
        "first report completed before second process": events(first, "buzz_report")[0]["at"] < created_b["at"],
        "remembered revision recovered": recalled["revision"] == remembered["data"]["result"]["revision"] == 3,
        "remembered body recovered exactly": json.loads(recalled["body"])["text"] == remembered["data"]["args"]["text"]})

    timer = "scheduled-learning-live-001"
    scheduled, fired = events(timer, "timer_scheduled")[-1], events(timer, "timer_fired")[-1]
    created = events(timer, "agent_created")[-1]
    with database() as db:
        budget = [json.loads(r[0]) for r in db.execute("SELECT data FROM events WHERE job='tick' AND action='budget'")]
    save_case(manifest, "scheduled-learning", [timer], {"scheduled": scheduled, "fired": fired, "started": created}, {
        "two-second real timer elapsed": fired["at"] >= scheduled["data"]["due_at"],
        "Hermes started after trigger": created["at"] >= fired["at"],
        "bounded to one conversation": any(b["limit"] == 1 and b["executed"] == [timer] for b in budget),
        "retrieved existing notebook": bool(events(timer, "recall")),
        "saved a question with evidence": any(e["data"]["args"].get("kind") == "question" and e["data"]["args"].get("evidence") for e in events(timer, "remember")),
        "saved the scheduled report": any(e["data"]["args"].get("path") == "scheduled-learning.md" for e in events(timer, "write"))})

    rollback = "reviewer-candidate-rollback"
    reads = events(rollback, "recall")
    before = reads[0]["data"]["result"][0]
    after = reads[-1]["data"]["result"][0]
    restored = json.loads(after["body"])
    historical = {r["revision"]: json.loads(r["body"]) for r in after["history"]}
    writes = events(rollback, "remember")
    save_case(manifest, "candidate-rollback", [rollback], {
        "before": before, "restoration": writes, "after": after}, {
        "reviewer inspected the injected candidate": before["revision"] == 3,
        "reviewer actually requested historical restoration": any(e["data"]["args"].get("restore_revision") == 2 for e in writes),
        "restoration created a new revision": after["revision"] == 4 and restored.get("restored_from") == 2,
        "restored exact previous skill text": restored.get("text") == historical.get(2, {}).get("text"),
        "candidate was not promoted": restored.get("status") == "candidate",
        "all previous revisions survive": set(historical) == {1, 2, 3},
        "rejected revision preserved exactly": historical.get(3) == json.loads(before["body"]),
        "restoration records evidence": bool(restored.get("restoration_evidence"))})

    parent = "native-e81082da44e1f0f4b2207a35fec89103abd7337e"
    product, review = "auto-product-002", "auto-review-002"
    synthesis = "synthesis-42dd3f9d8529953c1c9e902c932a322f27976057"
    if all(run in manifest["runs"] for run in (parent, product, review, synthesis)):
        with database() as db:
            jobs = {r["id"]: dict(r) for r in db.execute(
                "SELECT id,parent,role,status,started,attempts FROM jobs WHERE id IN (?,?,?)", (product, review, synthesis))}
            dependencies = [tuple(r) for r in db.execute(
                "SELECT job,prerequisite FROM job_dependencies WHERE job IN (?,?)", (review, synthesis))]
            untouched = [dict(r) for r in db.execute(
                "SELECT id,status,attempts FROM jobs WHERE id IN ('auto-product-001','auto-review-001')")]
        save_case(manifest, "delegation-review-synthesis", [parent, product, review, synthesis], {
            "jobs": jobs, "dependencies": dependencies, "unrelated": untouched,
            "driver": events(parent, "driver_launched"), "outcome": events(parent, "mandate_synthesis")}, {
            "native completion launched the driver": bool(events(parent, "driver_launched")),
            "specialists belong to that mandate": all(jobs[j]["parent"] == parent for j in (product, review)),
            "all conversations completed once": all(j["status"] == "done" and j["attempts"] == 1 for j in jobs.values()),
            "review waited for product evidence": (review, product) in dependencies and jobs[review]["started"] > events(product, "buzz_report")[-1]["at"],
            "synthesis waited for both specialists": all((synthesis, j) in dependencies and jobs[synthesis]["started"] > events(j, "buzz_report")[-1]["at"] for j in (product, review)),
            "independent reviewer role": jobs[review]["role"] == "reviewer" and jobs[product]["role"] == "product",
            "other mandate was not consumed": len(untouched) == 2 and all(r["status"] == "queued" and r["attempts"] == 0 for r in untouched),
            "final synthesis did not delegate": not events(synthesis, "delegate"),
            "driver recorded completed synthesis": any(e["data"].get("status") == "done" for e in events(parent, "mandate_synthesis"))})
    results_job = "synthesis-results-handoff-check"
    if results_job in manifest["runs"]:
        errors = validate_run(results_job, manifest["runs"][results_job], manifest["channel"])
        calls = events(results_job, "results")
        rows = calls[0]["data"]["result"] if len(calls) == 1 else []
        valid = not errors and {r["id"] for r in rows} == {"auto-product-002", "auto-review-002"} and all(r["status"] == "done" for r in rows)
        path = ROOT / "evidence/assessments/results-handoff-check.json"
        write_json(path, {"scope": "Separate explicit results query after the native chain", "actual_results": rows, "run_errors": errors})
        case = manifest["cases"]["delegation-review-synthesis"]
        case["run_ids"].append(results_job)
        case["artifacts"].append(proof(path))
        case["assertions"].append({"criterion": "results retrieves exactly the completed dependencies", "passed": valid, "evidence_path": proof(path)["path"]})
        if not valid:
            case["status"] = "FAIL"
    write_json(ROOT / "verification.json", manifest)
    print(json.dumps({name: manifest["cases"][name]["status"] for name in ("buzz-native-transport", "memory-after-restart", "scheduled-learning", "candidate-rollback")}))


if __name__ == "__main__":
    main()
