"""Regression coverage for wrong-fixture reviews and incomplete source consumption."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pilot
import verify
from review_inputs import validate_inputs


class ReviewInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.proofs = []
        self.inputs = []
        self.trace = {"messages": []}
        for purpose, text in [("target", "A reviewed report"), ("source", "The assigned fixture")]:
            path = self.root / (purpose + ".txt")
            path.write_text(text)
            self.proofs.append({"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            self.inputs.append({"purpose": purpose, "artifact": path.name, "action": "read", "path": path.name})
            self.read(purpose, path.name, text, self.proofs[-1]["sha256"])

    def read(self, call_id, path, text, digest, offset=0):
        self.trace["messages"].extend([
            {"role": "assistant", "tool_calls": [{"id": call_id, "function": {"name": "pilot", "arguments": json.dumps({"action": "read", "args": {"path": path}})}}]},
            {"role": "tool", "tool_call_id": call_id, "content": json.dumps({"content": text, "sha256": digest, "offset": offset})},
        ])

    def check(self):
        return validate_inputs({"inputs": self.inputs}, self.proofs, self.trace, self.root)

    def test_correct_inputs_pass_and_wrong_fixture_fails(self):
        self.assertEqual(self.check(), [])
        self.trace["messages"][2]["tool_calls"][0]["function"]["arguments"] = json.dumps({"action": "read", "args": {"path": "wrong-fixture.txt"}})
        self.assertIn("complete matching input", " ".join(self.check()))

    def test_hash_alone_or_partial_content_is_not_a_read(self):
        response = json.loads(self.trace["messages"][3]["content"])
        response["content"] = "The assigned"
        self.trace["messages"][3]["content"] = json.dumps(response)
        self.assertTrue(self.check())
        self.read("continuation", "source.txt", " fixture", self.proofs[1]["sha256"], 12)
        self.assertEqual(self.check(), [])

    def test_denial_unmatched_reply_and_changed_source_fail(self):
        self.trace["messages"][3]["content"] = '{"error":"PermissionError"}'
        self.assertTrue(self.check())
        self.trace["messages"][1]["tool_call_id"] = "unknown"
        self.assertEqual(len(self.check()), 2)
        (self.root / "target.txt").write_text("Changed after review")
        self.assertIn("input changed", " ".join(self.check()))

    def test_context_source_requires_full_body_and_correct_corpus(self):
        self.inputs[1].update(action="context", source="standards", path="standard.md")
        call = self.trace["messages"][2]["tool_calls"][0]["function"]
        call["arguments"] = json.dumps({"action": "context", "args": {"source": "standards", "path": "standard.md"}})
        self.trace["messages"][3]["content"] = json.dumps({"text": "The assigned fixture", "sha256": self.proofs[1]["sha256"]})
        self.assertEqual(self.check(), [])
        call["arguments"] = json.dumps({"action": "context", "args": {"source": "blueprints", "path": "standard.md"}})
        self.assertTrue(self.check())

    def test_completion_gate_rejects_missing_input_contract(self):
        # This uses verify.main: removing the production integration must fail this test.
        trace_path = self.root / "trace.json"
        trace_path.write_text(json.dumps(self.trace))
        trace_proof = {"path": trace_path.name, "sha256": hashlib.sha256(trace_path.read_bytes()).hexdigest()}
        review = {"reviewer": "reviewer", "run_id": "review", "scores": [2]*4, "critical_failures": [], "artifact": "target.txt"}
        case = {"status": "PASS", "author": "writer", "run_ids": ["author", "review"], "artifacts": self.proofs,
                "assertions": [{"passed": True, "evidence_path": "target.txt"}], "review": review}
        run = {"community": verify.SAPIRA, "combo": pilot.MODEL, "tool_trace": trace_proof, "buzz_event": trace_proof}
        manifest = {"community": verify.SAPIRA, "combo": pilot.MODEL, "channel": "test", "project": "test", "cases": {"role-writer-baseline": case},
                    "runs": {"author": {**run, "role": "writer"}, "review": {**run, "role": "reviewer"}},
                    "capability_catalog": ["context", "read"], "catalog_definition": {"writer": ["context", "read"]},
                    "coverage": {"read": ["role-writer-baseline"], "context": ["role-writer-baseline"]}}
        output = io.StringIO()
        with patch.object(verify, "ROOT", self.root), patch.object(verify, "REQUIRED", {"role-writer-baseline"}), patch.object(verify, "PERMISSIONS", {"writer": {"read"}}), patch.object(verify, "validate_run", return_value=[]), patch.object(verify, "successful_actions", return_value={"read", "context"}), contextlib.redirect_stdout(output):
            (self.root / "verification.json").write_text(json.dumps(manifest))
            self.assertEqual(verify.main(), 1)
            review["inputs"] = self.inputs
            (self.root / "verification.json").write_text(json.dumps(manifest))
            self.assertEqual(verify.main(), 0, output.getvalue())


if __name__ == "__main__":
    unittest.main()
