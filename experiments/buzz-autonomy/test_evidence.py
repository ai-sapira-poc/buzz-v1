"""Protect agent-authored evidence from final-response bookkeeping."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import evidence
import pilot


class ReportPersistenceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        for module in (pilot, evidence):
            override = patch.object(module, "ROOT", Path(directory.name))
            override.start()
            self.addCleanup(override.stop)

    def test_authored_deliverable_survives_final_summary(self):
        path = pilot.safe_path("reports/task.md")
        path.parent.mkdir(parents=True)
        path.write_text("Detailed signed-off-by-nobody report with stable hash")
        evidence.report("task", {"final_response": "Report saved; see its hash"})
        self.assertEqual(path.read_text(), "Detailed signed-off-by-nobody report with stable hash")
        self.assertEqual((pilot.ROOT / "evidence/task/final-response.md").read_text(), "Report saved; see its hash")

    def test_retry_replaces_generated_summary_but_not_new_authored_report(self):
        evidence.report("task", {"final_response": "partial"})
        evidence.report("task", {"final_response": "complete"})
        path = pilot.safe_path("reports/task.md")
        self.assertEqual(path.read_text(), "complete")
        path.write_text("New actual deliverable")
        evidence.report("task", {"final_response": "Final receipt"})
        self.assertEqual(path.read_text(), "New actual deliverable")


if __name__ == "__main__":
    unittest.main()
