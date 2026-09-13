"""Synthesis can inspect its handoff without reading another mandate's results."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import capabilities
import pilot


class ResultsScopeTests(unittest.TestCase):
    def test_children_and_dependencies_are_visible_but_other_work_is_not(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pilot, "ROOT", Path(directory)), patch.object(capabilities, "ROOT", Path(directory)):
                pilot.enqueue("coder", "private other mandate", "unrelated", parent="other")
                pilot.enqueue("product", "input", "input")
                pilot.enqueue("maestro", "synthesis", "summary", depends_on=["input"])
                pilot.enqueue("reviewer", "child", "child", parent="summary")
                rows = capabilities.operate("maestro", "summary", "results", {})
                self.assertEqual({r["id"] for r in rows}, {"input", "child"})


if __name__ == "__main__":
    unittest.main()
