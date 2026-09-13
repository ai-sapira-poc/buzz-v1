"""Guard the accounting, because a wrong number here gets quoted as fact."""
import os
import tempfile
import unittest
from pathlib import Path

import economics
import pilot


class Accounting(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous_root = pilot.ROOT
        pilot.ROOT = Path(self.directory.name)
        self.previous_price = (economics.PRICE_IN, economics.PRICE_OUT)
        economics.PRICE_IN = economics.PRICE_OUT = None

    def tearDown(self):
        pilot.ROOT = self.previous_root
        economics.PRICE_IN, economics.PRICE_OUT = self.previous_price
        self.directory.cleanup()

    def turn(self, job, role, input_tokens, output_tokens):
        pilot.event(job, role, "turn_usage", {
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "model": pilot.MODEL, "harness": "hermes",
        })

    def test_an_unknown_price_is_reported_as_unknown(self):
        # Inventing a cost is worse than having none: the invented one gets
        # quoted, and nobody remembers it was a guess.
        self.turn("tower-a", "product", 1000, 100)
        factors = economics.equation("tower")
        self.assertEqual(factors["precio_por_token"], "desconocido")
        self.assertIsNone(factors["coste"])

    def test_a_known_price_produces_money(self):
        economics.PRICE_IN, economics.PRICE_OUT = "1.0", "3.0"
        self.turn("tower-a", "product", 1_000_000, 1_000_000)
        self.assertAlmostEqual(economics.equation("tower")["coste"], 4.0)

    def test_the_six_factors_multiply_back_to_the_tokens_spent(self):
        # If the decomposition does not reconstruct the total, it is decoration.
        for index in range(4):
            self.turn("tower-a", "product", 1000, 100)
        for index in range(2):
            self.turn("tower-b", "research", 2000, 200)
        factors = economics.equation("tower")
        reconstructed = (factors["operadores"]
                         * factors["encargos_por_operador"]
                         * factors["turnos_por_encargo"]
                         * factors["peticiones_por_turno"]
                         * factors["tokens_por_peticion"])
        actual = factors["tokens_entrada"] + factors["tokens_salida"]
        self.assertAlmostEqual(reconstructed, actual, delta=actual * 0.02)

    def test_spending_with_no_delivery_is_named_waste(self):
        # A cheaper turn that fails is not cheaper. It is a smaller payment for
        # nothing, and must not read as efficiency.
        pilot.enqueue("product", "brief", "tower-a")
        for index in range(3):
            self.turn("tower-a", "product", 4000, 400)
        rows = economics.per_outcome("tower")
        self.assertTrue(rows[0]["desperdicio"])
        self.assertFalse(rows[0]["entregado"])

        with pilot.database() as db:
            db.execute("UPDATE jobs SET status='done' WHERE id='tower-a'")
        self.assertFalse(economics.per_outcome("tower")[0]["desperdicio"])

    def test_a_repeated_preamble_is_detected_and_priced(self):
        # Our own briefs re-send the contract and handoff on every turn, so a
        # long assignment pays for the same preamble N times.
        for index in range(6):
            self.turn("tower-a", "product", 12000, 300)
        found = [f for f in economics.anti_patterns("tower")
                 if f["patron"] == "preámbulo repetido"]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["impacto_tokens"], 12000 * 5)
        self.assertIn("handoff", found[0]["remedio"])

    def test_growing_context_is_detected(self):
        for tokens in (5000, 20000, 60000, 120000):
            self.turn("tower-b", "research", tokens, 200)
        patterns = {f["patron"] for f in economics.anti_patterns("tower")}
        self.assertIn("contexto que se hincha", patterns)

    def test_every_finding_carries_a_remedy(self):
        # A finding without something to do about it is a complaint.
        for index in range(6):
            self.turn("tower-a", "product", 12000, 300)
        for finding in economics.anti_patterns("tower"):
            with self.subTest(finding=finding["patron"]):
                self.assertTrue(finding["remedio"].strip())
                self.assertIn("impacto_tokens", finding)

    def test_findings_are_ordered_by_what_they_cost(self):
        for index in range(6):
            self.turn("tower-a", "product", 12000, 300)
        for tokens in (5000, 20000, 60000, 120000):
            self.turn("tower-b", "research", tokens, 200)
        findings = economics.anti_patterns("tower")
        impacts = [f["impacto_tokens"] for f in findings]
        self.assertEqual(impacts, sorted(impacts, reverse=True))


class DurableUsage(unittest.TestCase):
    def test_usage_survives_without_a_collector(self):
        # Traces go to an optional, sampled collector that is absent on a normal
        # day, and Buzz's own per-turn metric is encrypted to the owner with no
        # decrypt path from the CLI. Neither could answer "what did this cost".
        source = (Path(__file__).parent / "control_plane/telemetry.py").read_text()
        self.assertIn('"turn_usage"', source)
        self.assertIn("accounting must never fail the work", source)

    def test_both_harnesses_report_their_turns(self):
        for path in ("worker.py", "control_plane/pi_harness.py"):
            with self.subTest(path=path):
                source = (Path(__file__).parent / path).read_text()
                self.assertIn("job=job", source)
                self.assertIn("harness=", source)


if __name__ == "__main__":
    unittest.main()


class CodeMode(unittest.TestCase):
    """One turn for several operations — Uber's largest measured token lever."""

    def setUp(self):
        import capabilities
        self.capabilities = capabilities
        self.directory = tempfile.TemporaryDirectory()
        self.previous = (pilot.ROOT, capabilities.ROOT)
        pilot.ROOT = capabilities.ROOT = Path(self.directory.name)
        (pilot.ROOT / "artifacts").mkdir()

    def tearDown(self):
        pilot.ROOT, self.capabilities.ROOT = self.previous
        self.directory.cleanup()

    def test_several_operations_run_in_one_call(self):
        (pilot.ROOT / "artifacts/a.txt").write_text("primero")
        (pilot.ROOT / "artifacts/b.txt").write_text("segundo")
        out = self.capabilities.operate("reviewer", "job", "batch", {"steps": [
            {"action": "read", "args": {"path": "a.txt"}},
            {"action": "read", "args": {"path": "b.txt"}},
        ]})
        self.assertEqual(len(out["results"]), 2)
        self.assertTrue(all(r["ok"] for r in out["results"]))
        self.assertEqual(out["results"][0]["result"]["content"], "primero")

    def test_a_batch_grants_no_permission_its_steps_lack(self):
        # The whole safety argument for batching is that it changes how many
        # turns work costs, never what the work may do.
        with self.assertRaises(PermissionError):
            self.capabilities.operate("designer", "job", "batch", {"steps": [
                {"action": "delegate", "args": {"role": "coder", "prompt": "x", "id": "y"}},
            ]})
        # An unauthorised step fails as a step rather than throwing away the
        # batch — but it must still fail, still be named, and still stop the
        # rest, so a denial can never be mistaken for work that happened.
        (pilot.ROOT / "artifacts/a.txt").write_text("primero")
        out = self.capabilities.operate("designer", "job", "batch", {"steps": [
            {"action": "fetch", "args": {"url": "https://arxiv.org/abs/1"}},
            {"action": "read", "args": {"path": "a.txt"}},
        ]})
        self.assertFalse(out["results"][0]["ok"])
        self.assertEqual(out["results"][0]["error"], "PermissionError")
        self.assertEqual(len(out["results"]), 1, "una denegación detiene el batch")

    def test_a_batch_cannot_nest_into_a_loop(self):
        with self.assertRaises(PermissionError):
            self.capabilities.operate("reviewer", "job", "batch", {"steps": [
                {"action": "batch", "args": {"steps": []}},
            ]})

    def test_a_failing_step_keeps_the_work_already_done(self):
        # Throwing the batch away on any error would make batching riskier than
        # the sequential calls it replaces, which would defeat the point.
        (pilot.ROOT / "artifacts/a.txt").write_text("primero")
        out = self.capabilities.operate("reviewer", "job", "batch", {"steps": [
            {"action": "read", "args": {"path": "a.txt"}},
            {"action": "read", "args": {"path": "no-existe.txt"}},
            {"action": "read", "args": {"path": "a.txt"}},
        ]})
        self.assertTrue(out["results"][0]["ok"])
        self.assertFalse(out["results"][1]["ok"])
        self.assertEqual(len(out["results"]), 2, "debe parar, no seguir a ciegas")

    def test_the_batch_is_bounded(self):
        with self.assertRaises(ValueError):
            self.capabilities.operate("reviewer", "job", "batch", {"steps": [
                {"action": "recall", "args": {}} for _ in range(13)
            ]})

    def test_agents_are_told_batch_exists(self):
        # A lever nobody is told about is not a lever.
        source = (Path(__file__).parent / "capabilities.py").read_text()
        self.assertIn("runs several operations in ONE turn", source)
        self.assertIn('PERMISSIONS[role] | {"batch"}', source)
