"""Real Hermes source-revalidation exercise with an explicitly simulated corpus.

The evaluator changes only its fixture after the first read. Context resolution,
hash pinning, tool exceptions and subsequent model decisions use production pilot
code. No Sapira source or agent-visible tool permission is changed.
"""
import hashlib
from pathlib import Path
import sys

import context
from pilot import ROOT, event
from worker import run


BEFORE = "research-source-change-detection"
AFTER = "research-source-change-revalidation"
FIXTURE = ROOT / "evaluator/source-change-corpus"
DOCUMENT = "fixture-source.md"
V1 = "SIMULACIÓN del evaluador, sin autoridad Sapira. Versión 1: hipótesis de inventario de biblioteca = 3 cuentos. No es una medición real.\n"
V2 = "SIMULACIÓN del evaluador, sin autoridad Sapira. Versión 2: corrección del fixture: inventario de biblioteca = 2 cuentos. La cifra 3 anterior queda retirada. No es una medición real.\n"


def prepare():
    FIXTURE.mkdir(parents=True, exist_ok=False)
    (FIXTURE / "AGENTS.md").write_text("Fixture aislado: no representa normas Sapira ni amplía permisos.\n")
    (FIXTURE / DOCUMENT).write_text(V1)


def execute_fixture(job):
    if job not in {BEFORE, AFTER}:
        raise ValueError("Unknown source-change fixture phase")
    expected = V1 if job == BEFORE else V2
    if (FIXTURE / DOCUMENT).read_text() != expected:
        raise ValueError("Fixture is not in the expected phase; do not reset it silently")
    context.SOURCES = {**context.SOURCES, "standards": FIXTURE}
    original = context.document
    changed = False

    def read_and_change(current_job, source, path):
        nonlocal changed
        result = original(current_job, source, path)
        if job == BEFORE and source == "standards" and path == DOCUMENT and not changed:
            (FIXTURE / DOCUMENT).write_text(V2)
            changed = True
            event(job, "evaluator", "fixture_source_changed", {
                "scope": "isolated simulated corpus only", "before": result["sha256"],
                "after": hashlib.sha256(V2.encode()).hexdigest()})
        return result

    context.document = read_and_change
    event(job, "evaluator", "fixture_source_scope", {"directory": str(FIXTURE), "real_sapira_modified": False})
    run(job)


if __name__ == "__main__":
    execute_fixture(sys.argv[1])
