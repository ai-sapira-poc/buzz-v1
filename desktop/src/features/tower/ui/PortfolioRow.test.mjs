import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PortfolioRow } from "./PortfolioRow.tsx";
import { formatRecency } from "./portfolioFormat.ts";

function line(overrides = {}) {
  return {
    project: { id: "project-a", name: "Project A" },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
    ...overrides,
  };
}

function render(portfolioLine) {
  return renderToStaticMarkup(
    React.createElement(PortfolioRow, { line: portfolioLine }),
  );
}

test("an illegible cost renders as absent, never as a measured zero", () => {
  const html = render(line());
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /0 tok/);
  assert.doesNotMatch(html, /0 agents/);
});

test("a partial cost carries its coverage instead of a bare total", () => {
  const html = render(
    line({
      cost: {
        inputTokens: 12_000,
        outputTokens: 6_240,
        coverage: { observedAgents: 2, totalAgents: 3 },
      },
    }),
  );
  assert.match(html, /18,240 tok/);
  assert.match(html, /observed 2 of 3 agents/);
});

test("a full-coverage cost does not claim partial coverage", () => {
  const html = render(
    line({
      cost: {
        inputTokens: 1,
        outputTokens: 1,
        coverage: { observedAgents: 3, totalAgents: 3 },
      },
    }),
  );
  assert.match(html, /3 agents/);
  assert.doesNotMatch(html, /observed/);
});

test("an inferred block is labelled as inference with its citation", () => {
  const html = render(line({ blocked: { count: 1, basis: "inferred" } }));
  assert.match(html, /1 blocked/);
  assert.match(html, /inference/);
  assert.match(html, /derived state, not a span signal/);
});

test("an observed block cites the span and is not labelled inference", () => {
  const html = render(line({ blocked: { count: 2, basis: "observed" } }));
  assert.match(html, /2 blocked/);
  assert.doesNotMatch(html, /inference/);
});

test("no blocked basis means the row does not claim blocked", () => {
  const html = render(line());
  assert.match(html, /Unknown/);
  assert.doesNotMatch(html, /1 blocked/);
  assert.doesNotMatch(html, /inference/);
});

test("no readable span renders as absence, not as idle", () => {
  const html = render(line());
  assert.match(html, /No readable signal/);
});

test("formatRecency returns null for absent or unparseable timestamps", () => {
  assert.equal(formatRecency(null), null);
  assert.equal(formatRecency("not-a-date"), null);
  assert.equal(
    formatRecency(
      "2026-09-16T10:00:00.000Z",
      Date.parse("2026-09-16T10:04:00.000Z"),
    ),
    "4 min ago",
  );
});
