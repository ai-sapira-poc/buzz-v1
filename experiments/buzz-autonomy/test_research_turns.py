"""Pin the mechanisms that consumed the research role's 16-turn budget.

Autopsy of tower-research-cb003434 (failed, max_iterations_reached 16/16): 70
batch steps were requested, 43 ran, 27 never executed because an earlier step in
the same batch hit the fetch allowlist and `run_batch` stops at the first failure.
Five turns returned nothing but "Source outside public research allowlist" (153
bytes), one turn's batch result exceeded 100k characters and was truncated by
the harness, and the model re-fetched those pages the turn after. No `write` ever
happened.

The tests in `ResearchInstruction` bind the fix that lives in the roster. The
tests in `BatchProposals` pin the behaviour capabilities.py now has: a failed
step no longer aborts the independent steps after it, a denied fetch names the
whole allowlist, and a batch result stays under the harness stub threshold.
"""
import unittest
from unittest import mock

import capabilities
from control_plane import roster


class ResearchInstruction(unittest.TestCase):
    def setUp(self):
        self.text = roster.instruction("research")

    def test_names_every_allowlisted_host_from_the_single_source(self):
        # The allowlist lives in capabilities.PUBLIC_HOSTS; the roster must not
        # drift from it, so it is read from there rather than restated.
        for host in capabilities.PUBLIC_HOSTS:
            with self.subTest(host=host):
                self.assertIn(host, self.text)

    def test_warns_that_a_failing_batch_step_stops_the_rest(self):
        self.assertRegex(self.text, r"batch stops at its first failing step")
        self.assertIn("doubtful fetch last", self.text)

    def test_asks_to_persist_before_the_budget_ends(self):
        self.assertIn("`write` no later than turn 12", self.text)

    def test_sources_sit_before_the_method_not_after_the_anti_pattern(self):
        # A fact about what the tool can reach has to be read before the method
        # says "read primary sources", or the method is followed first and the
        # allowlist is discovered by denial.
        method_at = self.text.index(roster.CONTRACTS["research"]["method"])
        sources_at = self.text.index(roster.CONTRACTS["research"]["sources"])
        self.assertLess(sources_at, method_at)

    def test_only_roles_with_fetch_get_a_sources_section(self):
        for role, contract in roster.CONTRACTS.items():
            with self.subTest(role=role):
                identity = contract["identity"]
                has_fetch = "fetch" in capabilities.PERMISSIONS.get(identity, set())
                if contract.get("sources"):
                    self.assertTrue(has_fetch, f"{role} describes fetch it cannot use")


def _run_batch(steps, outcomes):
    """Drive capabilities.run_batch with `operate` replaced by a table of outcomes."""
    def fake_operate(role, job, action, args):
        outcome = outcomes[args["url"]]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome
    with mock.patch.object(capabilities, "operate", fake_operate), \
            mock.patch.object(capabilities, "event"):
        return capabilities.run_batch("research", "job", {"steps": steps})


class BatchProposals(unittest.TestCase):
    """The capabilities.py contract: no step lost, no allowlist guessed, no stub."""

    def test_a_denied_fetch_does_not_abort_the_independent_steps_after_it(self):
        steps = [{"action": "fetch", "args": {"url": u}} for u in ("a", "b", "c")]
        result = _run_batch(steps, {
            "a": PermissionError("Source outside public research allowlist"),
            "b": {"text": "B"},
            "c": {"text": "C"},
        })
        self.assertEqual([r["ok"] for r in result["results"]], [False, True, True])

    def test_fetch_denial_names_the_allowed_hosts(self):
        with mock.patch.object(capabilities, "event"), \
                self.assertRaises(PermissionError) as caught:
            capabilities.operate("research", "job", "fetch",
                                 {"url": "https://opentelemetry.io/docs"})
        for host in capabilities.PUBLIC_HOSTS:
            self.assertIn(host, str(caught.exception))

    def test_batch_result_stays_under_the_harness_truncation_threshold(self):
        steps = [{"action": "fetch", "args": {"url": str(i)}} for i in range(4)]
        result = _run_batch(steps, {str(i): {"text": "x" * 28000} for i in range(4)})
        self.assertLessEqual(len(capabilities.json.dumps(result)), 60000)
        self.assertTrue(any(r.get("truncated") for r in result["results"]))


if __name__ == "__main__":
    unittest.main()
