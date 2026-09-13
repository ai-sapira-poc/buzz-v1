"""The one door telemetry leaves the control plane through (ENG-STD-0018 §2).

Every span the team emits is created here. No module outside this one imports
the OpenTelemetry SDK — that is the whole point of the standard, and it is what
makes swapping the backend a change in one file rather than a search across the
codebase.

Attribute names follow the OTel `gen_ai.*` semantic conventions that Sapira
pinned in ENG-ADR-0002, not names of our own. The reason is migration: when the
domain model reads `gen_ai.usage.input_tokens` from a span, moving to any other
OTel backend is an identity mapping with no translation table to maintain.

Disabled by default. With no `OTEL_EXPORTER_OTLP_ENDPOINT` set, every function
here is a no-op that still returns a usable object, so the control plane runs
exactly as before on a machine with no collector. That mirrors how the relay's
own `telemetry.rs` behaves, deliberately.

What this module does NOT do: redaction, sampling, or retention by data class
(ENG-STD-0019, ENG-STD-0020). Those belong in the collector. Pointing this at a
collector that handles client data without them would violate those standards.
"""
import os
import time
from contextlib import contextmanager

DEFAULT_ENDPOINT = "http://localhost:4318"
SERVICE_NAME = "buzz-control-plane"

_provider = None
_tracer = None
_enabled: bool | None = None


def enabled() -> bool:
    """True when an OTLP endpoint is configured. Resolved once, then cached."""
    global _enabled
    if _enabled is None:
        _enabled = bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"))
    return _enabled


def _tracer_or_none():
    """Build the tracer on first use; never raise into the caller's path.

    A failure to export telemetry must never fail the work being measured. If
    the SDK cannot start, we record that fact and carry on unmeasured, because
    an agent that stops working because its observability broke is a worse
    outcome than an agent nobody can see.
    """
    global _provider, _tracer
    if not enabled():
        return None
    if _tracer is not None:
        return _tracer
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", DEFAULT_ENDPOINT)
        resource = Resource.create({
            "service.name": os.environ.get("OTEL_SERVICE_NAME", SERVICE_NAME),
        })
        _provider = TracerProvider(resource=resource)
        # Batched, so the export never sits on the turn's critical path.
        _provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=endpoint.rstrip("/") + "/v1/traces")
            )
        )
        trace.set_tracer_provider(_provider)
        _tracer = trace.get_tracer("control_plane")
        return _tracer
    except Exception as error:  # noqa: BLE001 - telemetry must not break work
        print(f"[telemetry] disabled: {type(error).__name__}: {error}", flush=True)
        _tracer = None
        globals()["_enabled"] = False
        return None


def trace_id_of(span) -> str | None:
    """The 32-hex trace id, which is also the Tower `run.id`.

    Returning it is the entire bridge between the span and the Nostr projection:
    the assignment's identifier IS the trace identifier, so nothing has to be
    correlated after the fact.
    """
    try:
        context = span.get_span_context()
        if not context or not context.trace_id:
            return None
        return format(context.trace_id, "032x")
    except Exception:  # noqa: BLE001
        return None


class _NoSpan:
    """Stands in for a span when telemetry is off, so callers need no branches."""

    def set_attribute(self, *_args, **_kwargs) -> None:
        return None

    def get_span_context(self):
        return None


@contextmanager
def assignment(job: str, role: str, project: str | None = None):
    """The root span of one assignment. Its trace id is the Tower run id."""
    tracer = _tracer_or_none()
    if tracer is None:
        yield _NoSpan()
        return
    with tracer.start_as_current_span("control_plane.assignment") as span:
        span.set_attribute("gen_ai.agent.name", role)
        span.set_attribute("buzz.job.id", job)
        if project:
            span.set_attribute("buzz.project.id", project)
        yield span


@contextmanager
def turn(role: str, harness: str, model: str):
    """One model turn, nested under the assignment."""
    tracer = _tracer_or_none()
    if tracer is None:
        yield _NoSpan()
        return
    with tracer.start_as_current_span("gen_ai.turn") as span:
        span.set_attribute("gen_ai.agent.name", role)
        span.set_attribute("gen_ai.request.model", model)
        span.set_attribute("gen_ai.system", harness)
        yield span


def record_usage(span, input_tokens: int, output_tokens: int, model: str | None = None) -> None:
    """Attach token usage under the pinned semantic-convention names."""
    span.set_attribute("gen_ai.usage.input_tokens", int(input_tokens or 0))
    span.set_attribute("gen_ai.usage.output_tokens", int(output_tokens or 0))
    if model:
        span.set_attribute("gen_ai.response.model", model)


def flush(timeout_ms: int = 5000) -> None:
    """Drain the batch processor. Call before a short-lived process exits."""
    if _provider is not None:
        try:
            _provider.force_flush(timeout_ms)
        except Exception:  # noqa: BLE001
            pass


def measure_overhead(iterations: int = 200) -> dict:
    """Measure what instrumenting costs, rather than assuming it is free.

    If measuring changes what is measured, the observability lies. This reports
    the per-span cost so the claim can be checked instead of asserted.
    """
    start = time.perf_counter()
    for index in range(iterations):
        with assignment(f"overhead-{index}", "analista"):
            pass
    elapsed = time.perf_counter() - start
    return {
        "enabled": enabled(),
        "iterations": iterations,
        "total_seconds": round(elapsed, 4),
        "per_span_ms": round(elapsed / iterations * 1000, 4),
    }
