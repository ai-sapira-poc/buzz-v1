import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TowerSection } from "./TowerSection.tsx";

function view(overrides = {}) {
  return {
    phase: "ready",
    lines: [],
    lastSuccessAt: null,
    failure: null,
    refreshing: false,
    retry: () => {},
    ...overrides,
  };
}

function line(overrides = {}) {
  return {
    project: { id: "project-a", name: "Project A" },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
    ...overrides,
  };
}

function render(portfolioView) {
  return renderToStaticMarkup(
    React.createElement(TowerSection, { view: portfolioView }),
  );
}

test("a healthy empty source renders the empty state, not the error", () => {
  const html = render(view({ phase: "ready", lines: [] }));
  assert.match(html, /tower-empty-state/);
  assert.doesNotMatch(html, /tower-error-state/);
  assert.match(html, /No lines to show/);
});

test("an unreadable source renders the error state, not the empty state", () => {
  const html = render(
    view({
      phase: "unreachable",
      lines: null,
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );
  assert.match(html, /tower-error-state/);
  assert.doesNotMatch(html, /tower-empty-state/);
  assert.match(html, /adapter_unavailable/);
  // No figures are shown when there is no snapshot.
  assert.doesNotMatch(html, /tok/);
});

test("a failure with a previous snapshot keeps the list and banners it", () => {
  const html = render(
    view({
      phase: "unreachable",
      lines: [line()],
      lastSuccessAt: "2026-09-16T10:00:00.000Z",
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );
  assert.match(html, /tower-stale-banner/);
  assert.match(html, /tower-portfolio-list/);
  assert.doesNotMatch(html, /tower-error-state/);
});

test("the stale banner carries the only retry control of the branch", () => {
  const html = render(
    view({
      phase: "unreachable",
      lines: [line()],
      lastSuccessAt: "2026-09-16T10:00:00.000Z",
      failure: { code: "adapter_unavailable", message: "no relay" },
    }),
  );
  const retries = html.match(/Retry/g) ?? [];
  assert.equal(retries.length, 1);
});

test("no line is blocked, so no needs-attention banner is drawn", () => {
  const html = render(view({ phase: "ready", lines: [line()] }));
  assert.doesNotMatch(html, /tower-needs-attention/);
});

test("a blocked line raises the needs-attention banner", () => {
  const html = render(
    view({
      phase: "ready",
      lines: [line({ blocked: { count: 1, basis: "inferred" } })],
    }),
  );
  assert.match(html, /tower-needs-attention/);
  assert.match(html, /1 line needs you/);
});

test("the section announces its state in a single live region", () => {
  const loading = render(view({ phase: "loading", lines: null }));
  assert.match(loading, /aria-live="polite"/);
  assert.match(loading, /Loading lines/);

  const empty = render(view({ phase: "ready", lines: [] }));
  assert.match(empty, /No lines to show/);

  const unreachable = render(
    view({ phase: "unreachable", lines: null, failure: null }),
  );
  assert.match(unreachable, /Could not read the telemetry source/);
});
