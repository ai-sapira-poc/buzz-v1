"""Guard the telemetry door: one module, semconv names, and safe when off."""
import os
import pathlib
import re
import unittest

import pilot
from control_plane import telemetry


class DisabledByDefault(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.pop("OTEL_EXPORTER_OTLP_ENDPOINT", None)
        telemetry._enabled = None

    def tearDown(self):
        if self._saved is not None:
            os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = self._saved
        telemetry._enabled = None

    def test_no_endpoint_means_disabled(self):
        self.assertFalse(telemetry.enabled())

    def test_spans_are_usable_when_disabled(self):
        # Callers must not need an `if enabled()` branch; a machine with no
        # collector has to run the control plane exactly as before.
        with telemetry.assignment("j", "analista") as span:
            with telemetry.turn("analista", "hermes", pilot.MODEL) as inner:
                telemetry.record_usage(inner, 10, 5, pilot.MODEL)
            self.assertIsNone(telemetry.trace_id_of(span))

    def test_overhead_is_reported_not_assumed(self):
        result = telemetry.measure_overhead(20)
        self.assertEqual(result["iterations"], 20)
        self.assertIn("per_span_ms", result)


class OneDoor(unittest.TestCase):
    def test_only_telemetry_imports_the_otel_sdk(self):
        # ENG-STD-0018 §2: telemetry leaves an application through one door.
        # A second module importing the SDK is how that erodes.
        root = pathlib.Path(__file__).parent
        offenders = []
        for path in sorted(root.rglob("*.py")):
            if path.name in {"telemetry.py", "test_telemetry.py"}:
                continue
            if "archive" in path.parts:
                continue
            if re.search(r"^\s*(import|from)\s+opentelemetry",
                         path.read_text(), re.M):
                offenders.append(path.name)
        self.assertEqual(offenders, [], f"OTel imported outside the door: {offenders}")

    def test_pi_harness_records_its_turn(self):
        source = (pathlib.Path(__file__).parent
                  / "control_plane/pi_harness.py").read_text()
        self.assertIn("telemetry.turn(", source)
        self.assertIn("telemetry.record_usage(", source)
        self.assertIn("telemetry.trace_id_of(", source)


class SemanticConventions(unittest.TestCase):
    def test_attribute_names_are_otel_not_ours(self):
        # The migration is only cheap if the mapping is the identity. Renaming
        # any of these to a Buzz-flavoured name silently makes it a translation.
        source = (pathlib.Path(__file__).parent
                  / "control_plane/telemetry.py").read_text()
        for name in ("gen_ai.agent.name", "gen_ai.request.model",
                     "gen_ai.response.model", "gen_ai.usage.input_tokens",
                     "gen_ai.usage.output_tokens"):
            with self.subTest(attribute=name):
                self.assertIn(f'"{name}"', source)


if __name__ == "__main__":
    unittest.main()
