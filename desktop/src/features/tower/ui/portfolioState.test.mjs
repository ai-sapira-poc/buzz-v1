import assert from "node:assert/strict";
import test from "node:test";

import { TowerSourceError } from "../domain/TowerSource.ts";
import {
  derivePortfolioView,
  linesNeedingAttention,
  orderPortfolioLines,
} from "./portfolioState.ts";

function line(overrides = {}) {
  return {
    project: { id: "project-a", name: "Project A" },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
    work: null,
    ...overrides,
  };
}

const retry = () => {};

function snapshot(overrides) {
  return {
    isPending: false,
    isFetching: false,
    isError: false,
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    ...overrides,
  };
}

test("first load with no snapshot is a loading phase", () => {
  const view = derivePortfolioView(
    snapshot({ isPending: true, isFetching: true }),
    retry,
  );
  assert.equal(view.phase, "loading");
  assert.equal(view.lines, null);
  assert.equal(view.refreshing, false);
});

test("a successful empty read is the ready phase with zero lines", () => {
  const view = derivePortfolioView(snapshot({ data: [] }), retry);
  assert.equal(view.phase, "ready");
  assert.deepEqual(view.lines, []);
  assert.equal(view.failure, null);
});

test("a failed read is unreachable, not an empty result", () => {
  const view = derivePortfolioView(
    snapshot({
      isError: true,
      error: new TowerSourceError("adapter_unavailable", "no relay"),
    }),
    retry,
  );
  assert.equal(view.phase, "unreachable");
  assert.equal(view.lines, null);
  assert.equal(view.failure?.code, "adapter_unavailable");
});

test("a failure without a citable code reports null, not an invented code", () => {
  const view = derivePortfolioView(
    snapshot({ isError: true, error: new Error("boom") }),
    retry,
  );
  assert.equal(view.failure?.code, null);
  assert.equal(view.failure?.message, "boom");
});

test("a failure with a previous snapshot keeps the lines (stale branch)", () => {
  const previous = [line()];
  const view = derivePortfolioView(
    snapshot({
      data: previous,
      dataUpdatedAt: Date.parse("2026-09-16T10:00:00.000Z"),
      isError: true,
      error: new TowerSourceError("adapter_unavailable", "no relay"),
    }),
    retry,
  );
  assert.equal(view.phase, "unreachable");
  assert.deepEqual(view.lines, previous);
  assert.equal(view.lastSuccessAt, "2026-09-16T10:00:00.000Z");
});

test("a background refetch over data is refreshing, not loading", () => {
  const view = derivePortfolioView(
    snapshot({ data: [line()], isFetching: true }),
    retry,
  );
  assert.equal(view.phase, "ready");
  assert.equal(view.refreshing, true);
});

test("failures rise, then most recent, and order is stable on ties", () => {
  const oldest = line({
    project: { id: "old", name: "Old" },
    recency: { lastSpanAt: "2026-09-16T09:00:00.000Z" },
  });
  const newest = line({
    project: { id: "new", name: "New" },
    recency: { lastSpanAt: "2026-09-16T11:00:00.000Z" },
  });
  const stuck = line({
    project: { id: "stuck", name: "Stuck" },
    blocked: { count: 1, basis: "inferred" },
  });
  const silent = line({
    project: { id: "silent", name: "Silent" },
    recency: { lastSpanAt: null },
  });
  const ordered = orderPortfolioLines([oldest, newest, stuck, silent]);
  assert.deepEqual(
    ordered.map((entry) => entry.project.id),
    ["stuck", "new", "old", "silent"],
  );
  // Same input, same order — a refetch that changes nothing moves nothing.
  assert.deepEqual(orderPortfolioLines(ordered), ordered);
});

test("needs-attention selects only lines with a blocked count", () => {
  const stuck = line({ blocked: { count: 2, basis: "observed" } });
  const fine = line({ project: { id: "fine", name: "Fine" } });
  assert.deepEqual(linesNeedingAttention([fine, stuck]), [stuck]);
});
