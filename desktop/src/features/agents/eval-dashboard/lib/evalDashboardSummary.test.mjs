/**
 * I2 criterion: the summary header (R5) must match a fresh recount of the
 * data it was given, not a cached/derived shortcut. Pure data-in/data-out —
 * no DOM, no Tauri bridge.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeEvalDashboardSummary } from "./evalDashboardSummary.ts";

function summary(overrides = {}) {
  return {
    dirName: "agent",
    dir: "/nest/.agents/evals/agent",
    exists: true,
    cases: [],
    feedback: [],
    bulletin: null,
    discrepancies: [],
    ...overrides,
  };
}

test("computeEvalDashboardSummary_empty_zerosEverything", () => {
  const result = computeEvalDashboardSummary([]);
  assert.deepEqual(result, {
    totalAgents: 0,
    totalCases: 0,
    regressions: 0,
  });
});

test("computeEvalDashboardSummary_countsAgentsCasesAndRegressions", () => {
  const summaries = [
    summary({
      dirName: "agent-builder",
      cases: [],
      bulletin: null,
    }),
    summary({
      dirName: "ana-soporte",
      cases: [{}, {}],
      bulletin: {
        trend: "sube",
        score: "0.75",
        date: "",
        runner: "",
        rows: [],
        problems: [],
      },
    }),
    summary({
      dirName: "delivery-lead",
      cases: [{}, {}, {}],
      bulletin: {
        trend: "baja",
        score: "0.40",
        date: "",
        runner: "",
        rows: [],
        problems: [],
      },
    }),
    summary({
      dirName: "pm",
      cases: [{}],
      bulletin: {
        trend: "estable",
        score: "0.90",
        date: "",
        runner: "",
        rows: [],
        problems: [],
      },
    }),
  ];

  const result = computeEvalDashboardSummary(summaries);

  // Independent recount taken at assertion time — same discipline the Rust
  // suite uses for I1 (a): not a hardcoded expectation copied from the input
  // literal above, but the actual reduce over the same data.
  const expectedAgents = summaries.length;
  const expectedCases = summaries.reduce((n, s) => n + s.cases.length, 0);
  const expectedRegressions = summaries.filter(
    (s) => s.bulletin?.trend === "baja",
  ).length;

  assert.equal(result.totalAgents, expectedAgents);
  assert.equal(result.totalCases, expectedCases);
  assert.equal(result.regressions, expectedRegressions);
  assert.equal(result.totalAgents, 4);
  assert.equal(result.totalCases, 6);
  assert.equal(result.regressions, 1);
});

test("computeEvalDashboardSummary_onlyBajaCountsAsRegression", () => {
  const summaries = [
    summary({ bulletin: { trend: "sube" } }),
    summary({ bulletin: { trend: "estable" } }),
    summary({ bulletin: { trend: "primera" } }),
    summary({ bulletin: null }),
  ];
  const result = computeEvalDashboardSummary(summaries);
  assert.equal(result.regressions, 0);
});
