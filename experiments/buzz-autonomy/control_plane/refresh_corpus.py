"""Re-snapshot the Sapira standards corpus into the pilot's isolated runtime.

`context.resolve` refuses to run when the isolated runtime has drifted from the
source corpus, because resolving applicability against a stale snapshot would
report standards that no longer say what the resolver claims. That guard is
correct; this is the intended way to clear it.

Only the files the manifest actually fingerprints are copied — the four corpus
folders and the six root documents. `node_modules` in the runtime is left alone:
it carries the resolver's installed dependencies, is excluded from the manifest,
and re-copying it would be slow and pointless.

Reads the source corpus, writes only inside the pilot root. It never writes to
any repository.
"""
import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import control_plane  # noqa: F401  (pins BUZZ_PILOT_HOME before pilot loads)
import context
from pilot import ROOT

FOLDERS = ("scripts", "company", "departments", "exceptions")
ROOT_DOCS = ("AGENTS.md", "BACKLOG.md", "CLAUDE.md", "CONTRIBUTING.md",
             "GOVERNANCE.md", "PLAN.md")
SUFFIXES = {".md", ".mjs", ".json", ".yaml"}


def plan(source: Path, runtime: Path) -> tuple[list, list]:
    """Return (to_copy, to_delete) as paths relative to the corpus root."""
    before = context.corpus_manifest(runtime)
    after = context.corpus_manifest(source)
    to_copy = sorted(k for k in after if before.get(k) != after[k])
    to_delete = sorted(set(before) - set(after))
    return to_copy, to_delete


def refresh(apply: bool = False) -> int:
    source = context.SOURCES["standards"]
    runtime = ROOT / "corpus-runtime"
    if not source.is_dir():
        raise FileNotFoundError(f"Standards corpus not found at {source}")
    if not runtime.is_dir():
        raise FileNotFoundError(f"Isolated runtime not found at {runtime}")

    to_copy, to_delete = plan(source, runtime)
    print(f"source : {source}")
    print(f"runtime: {runtime.resolve()}")
    print(f"nuevos o modificados: {len(to_copy)}   retirados: {len(to_delete)}")
    for name in to_copy[:12]:
        print("  +", name)
    for name in to_delete[:12]:
        print("  -", name)
    if not apply:
        print("\n(simulación — usa --apply para escribir)")
        return 0 if not (to_copy or to_delete) else 1

    for name in to_copy:
        src, dst = source / name, runtime / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    for name in to_delete:
        target = runtime / name
        if target.is_file():
            target.unlink()

    # Verify rather than assume: a refresh that silently left the manifests
    # different would push the failure back into the next agent run, where it is
    # far more expensive to diagnose.
    if context.corpus_manifest(runtime) != context.corpus_manifest(source):
        raise RuntimeError("Refresh did not converge; runtime still differs from source")
    print(f"\nconvergido: {len(context.corpus_manifest(source))} ficheros idénticos")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes")
    raise SystemExit(refresh(parser.parse_args().apply))
