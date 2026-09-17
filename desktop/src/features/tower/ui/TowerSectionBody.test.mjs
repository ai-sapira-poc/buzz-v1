import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TowerSectionBody } from "./TowerSectionBody.tsx";

function view(overrides = {}) {
  return {
    phase: "ready",
    lines: null,
    lastSuccessAt: null,
    failure: null,
    refreshing: false,
    retry: () => {},
    ...overrides,
  };
}

function line(id) {
  return {
    project: { id, name: id.toUpperCase() },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
  };
}

function html(node) {
  return renderToStaticMarkup(node);
}

test("loading with no snapshot renders the skeleton and announces loading", () => {
  const markup = html(
    React.createElement(TowerSectionBody, {
      view: view({ phase: "loading", lines: null }),
    }),
  );
  assert.match(markup, /data-testid="tower-loading-state"/);
  assert.match(markup, /Loading lines/);
});

test("a ready empty read renders the empty state — never a blank section", () => {
  const markup = html(
    React.createElement(TowerSectionBody, {
      view: view({ phase: "ready", lines: [] }),
    }),
  );
  assert.match(markup, /data-testid="tower-empty-state"/);
  assert.match(markup, /No lines to show yet/);
  assert.match(markup, /No lines to show/);
});

test("a stale empty snapshot still explains itself — never a blank body", () => {
  // Reachable: React Query keeps `data: []` across a refetch error, so the
  // phase is `unreachable` while the retained snapshot is an empty list. The
  // stale banner (TowerSection) sits above this body, which must not be blank.
  const markup = html(
    React.createElement(TowerSectionBody, {
      view: view({
        phase: "unreachable",
        lines: [],
        lastSuccessAt: "2026-09-16T10:00:00.000Z",
        failure: { code: "adapter_unavailable", message: "boom" },
      }),
    }),
  );
  assert.match(markup, /data-testid="tower-empty-state"/);
  assert.doesNotMatch(markup, /data-testid="tower-error-state"/);
});

test("an unreachable read with no snapshot renders the error state and no list", () => {
  const markup = html(
    React.createElement(TowerSectionBody, {
      view: view({
        phase: "unreachable",
        lines: null,
        failure: { code: "adapter_unavailable", message: "boom" },
      }),
    }),
  );
  assert.match(markup, /data-testid="tower-error-state"/);
  assert.match(markup, /adapter_unavailable/);
  assert.doesNotMatch(markup, /data-testid="tower-portfolio-list"/);
});

test("lines render as a list and announce the singular count", () => {
  const markup = html(
    React.createElement(TowerSectionBody, {
      view: view({ phase: "ready", lines: [line("p1")] }),
    }),
  );
  assert.match(markup, /data-testid="tower-portfolio-list"/);
  assert.match(markup, />1 line</);
});
