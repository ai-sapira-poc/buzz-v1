"""Prepare paired, isolated views for held-out learning evaluation."""
import hashlib
import json
import shutil
import sqlite3
import time

from pilot import ROOT, ROLES, config, database, write_json


def prepare(role="innovation"):
    """Freeze one candidate before revealing the same fixture to both conditions."""
    fixture = ROOT / "evaluator" / "heldout-transfer.json"
    skill_file = ROOT / "artifacts" / "skills" / "product-learning-candidate.md"
    with database() as db:
        notes = [dict(r) for r in db.execute("SELECT * FROM notebook")]
    skill = next(r for r in notes if r["id"] == "skill-simulated-evidence-eval-001")
    frozen = {"released_at": time.time(), "fixture_sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
              "skill_revision": skill["revision"], "skill_sha256": hashlib.sha256(skill_file.read_bytes()).hexdigest(),
              "design": "same role, combo, budget, fixture and non-skill notebook; candidate present only in treatment"}
    views = []
    for condition in ("without-skill", "with-skill"):
        view = ROOT / "evaluator" / "trials" / condition
        if view.exists():
            raise RuntimeError("Trial view already exists; do not overwrite experimental history")
        (view / "artifacts").mkdir(parents=True, mode=0o700)
        write_json(view / "config.json", config())
        (view / "corpus-runtime").symlink_to((ROOT / "corpus-runtime").resolve(), target_is_directory=True)
        for name in ROLES:
            home = view / "profiles" / name; home.mkdir(parents=True, mode=0o700)
            shutil.copyfile(ROOT / "profiles" / name / "config.yaml", home / "config.yaml")
            (home / "config.yaml").chmod(0o600)
            (home / ".no-bundled-skills").touch()
        shutil.copyfile(fixture, view / "artifacts" / "brief.md")
        # Schema matches the notebook portion used by database(); all other tables
        # are created normally when the trial's worker starts.
        with sqlite3.connect(view / "pilot.db") as db:
            db.execute("CREATE TABLE notebook (id TEXT PRIMARY KEY, project TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated REAL NOT NULL)")
            for note in notes:
                if note["kind"] == "skill" and (condition == "without-skill" or note["id"] != skill["id"]):
                    continue
                db.execute("INSERT INTO notebook VALUES(?,?,?,?,?,?)", tuple(note[k] for k in ("id","project","kind","body","revision","updated")))
        if condition == "with-skill":
            (view / "artifacts" / "skills").mkdir()
            shutil.copyfile(skill_file, view / "artifacts" / "skills" / "product-learning-candidate.md")
        write_json(view / "trial.json", {**frozen, "condition": condition, "role": role})
        views.append(str(view))
    write_json(ROOT / "evaluator" / "trial-design.json", {**frozen, "views": views})
    return views


if __name__ == "__main__":
    print(json.dumps(prepare()))
