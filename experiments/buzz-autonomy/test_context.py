"""Source consistency checks use disposable corpora, never edit Sapira repositories."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import context
import pilot


class SourceConsistency(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.source = base / "source"; self.source.mkdir()
        self.runtime = base / "state"; self.runtime.mkdir()
        for module in (context, pilot):
            patched = patch.object(module, "ROOT", self.runtime)
            patched.start(); self.addCleanup(patched.stop)
        patched = patch.object(context, "SOURCES", {"standards": self.source})
        patched.start(); self.addCleanup(patched.stop)

    def test_source_update_requires_new_run(self):
        path = self.source / "rule.md"; path.write_text("version one")
        first = context.document("first", "standards", "rule.md")
        path.write_text("version two")
        with self.assertRaises(RuntimeError):
            context.document("first", "standards", "rule.md")
        second = context.document("second", "standards", "rule.md")
        self.assertNotEqual(first["sha256"], second["sha256"])
        self.assertEqual(Path(first["snapshot"]).read_text(), "version one")

    def test_transitive_resolver_change_is_detected(self):
        copied = self.runtime / "corpus-runtime"
        for base in (self.source, copied):
            (base / "scripts/lib").mkdir(parents=True)
            (base / "scripts/standards-for.mjs").write_text("unchanged entrypoint")
            (base / "scripts/lib/applies.mjs").write_text("version one")
        self.assertEqual(context.corpus_manifest(self.source), context.corpus_manifest(copied))
        (self.source / "scripts/lib/applies.mjs").write_text("changed policy")
        with self.assertRaises(RuntimeError):
            context.resolve("changed")


if __name__ == "__main__":
    unittest.main()
