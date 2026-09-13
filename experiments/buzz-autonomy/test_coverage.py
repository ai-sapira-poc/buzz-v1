"""A denied call, an unmatched reply or mere prose must not establish coverage."""
import json
import unittest

from verify import successful_actions


class CoverageTests(unittest.TestCase):
    def test_denials_and_unmatched_results_do_not_count(self):
        trace = {"messages": [
            {"role": "assistant", "content": "I used every capability", "tool_calls": [
                {"id": "denied", "function": {"arguments": json.dumps({"action": "railway"})}},
                {"id": "ok", "function": {"arguments": json.dumps({"action": "read"})}}]},
            {"role": "tool", "tool_call_id": "denied", "content": '{"error":"PermissionError"}'},
            {"role": "tool", "tool_call_id": "unknown", "content": '{"service":"example"}'},
            {"role": "tool", "tool_call_id": "ok", "content": '{"content":"actual file"}'},
        ]}
        self.assertEqual(successful_actions(trace), {"read"})

    def test_call_without_response_does_not_count(self):
        trace = {"messages": [{"role": "assistant", "tool_calls": [
            {"id": "pending", "function": {"arguments": '{"action":"fetch"}'}}]}]}
        self.assertEqual(successful_actions(trace), set())


if __name__ == "__main__":
    unittest.main()
