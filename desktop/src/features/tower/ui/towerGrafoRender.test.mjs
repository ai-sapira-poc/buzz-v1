import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TowerSourceError } from "../domain/TowerSource.ts";
import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource";
import { GrafoSection } from "./GrafoSection.tsx";
import { derivePortfolioView } from "./portfolioState.ts";

/**
 * End-to-end through the port for the canvas: the real Buzz adapter reads agent
 * work, the view reduces it, the section draws cards. This binds the three
 * seams (adapter → domain → view) so a break in any one of them fails here
 * instead of only in the app, and it is the guard that fails when the canvas
 * starts drawing an edge, a blocked claim or a measured zero it does not have.
 */

function jobEvent({ kind, job, role, at, content = "" }) {
  return {
    id: `${job}-${kind}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content,
    sig: "sig",
    tags: [
      ["p", "owner"],
      ["job", job],
      ["role", role],
    ],
  };
}

function line({
  job,
  role,
  state = "running",
  summary = null,
  at = null,
  cost = null,
  waiting = null,
}) {
  return {
    project: { id: job, name: role },
    recency: { lastSpanAt: at },
    // No lifecycle evidence in these fixtures, so the basis stays `null`:
    // absence is information, and the canvas must not claim "blocked".
    blocked: { count: 0, basis: null },
    work: state === null ? null : { state, summary },
    cost,
    waiting,
  };
}

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

function render(view) {
  return renderToStaticMarkup(React.createElement(GrafoSection, { view }));
}

function countOf(html, testId) {
  return (html.match(new RegExp(`data-testid="${testId}"`, "g")) ?? []).length;
}

function columnTitles(html) {
  const titles = [];
  const pattern = /data-testid="tower-grafo-column-title"[^>]*>([^<]+)<\/h3>/g;
  for (const match of html.matchAll(pattern)) {
    titles.push(match[1]);
  }
  return titles;
}

test("real agent work renders as one card per job, grouped by role", async () => {
  const source = createTowerBuzzSource(
    async () => [
      jobEvent({ kind: 43002, job: "buzz-autonomy", role: "builder", at: 100 }),
      jobEvent({ kind: 43001, job: "npl-mp", role: "reviewer", at: 90 }),
      jobEvent({
        kind: 43002,
        job: "tower-grafo",
        role: "builder",
        at: 80,
        content: "drawing cards",
      }),
    ],
    async () => "owner",
  );

  const lines = await source.getPortfolio();
  const html = render(derivePortfolioView(snapshot({ data: lines }), () => {}));

  assert.equal(countOf(html, "tower-node"), 3);
  assert.deepEqual(columnTitles(html).sort(), ["builder", "reviewer"]);
  assert.doesNotMatch(html, /tower-empty-state/);
  assert.doesNotMatch(html, /tower-error-state/);
  assert.match(html, /Running/);
  assert.match(html, /Requested/);
  // The producer's own line rides the card; nothing is invented for the rest.
  assert.match(html, /drawing cards/);
});

test("the grouping is the role and says depth is not drawn", () => {
  const html = render(
    derivePortfolioView(
      snapshot({ data: [line({ job: "j1", role: "builder" })] }),
      () => {},
    ),
  );

  assert.match(html, /tower-grafo-grouping-note/);
  assert.match(html, /not the depth of the work/);
  assert.match(html, /handoff edges are not drawn on this surface yet/);
  // No connector of any kind: the canvas is a grouping, not a graph layout.
  assert.equal(countOf(html, "tower-grafo-edge"), 0);
  assert.doesNotMatch(html, /<svg/);
});

test("a line with no role is grouped, never dropped", () => {
  const html = render(
    derivePortfolioView(
      snapshot({
        data: [
          line({ job: "j1", role: "" }),
          line({ job: "j2", role: "builder" }),
        ],
      }),
      () => {},
    ),
  );

  assert.equal(countOf(html, "tower-node"), 2);
  assert.deepEqual(columnTitles(html).sort(), ["Unnamed agent", "builder"]);
});

test("model and cost with no producer read as absent, never as zero", () => {
  const html = render(
    derivePortfolioView(
      snapshot({ data: [line({ job: "j1", role: "builder" })] }),
      () => {},
    ),
  );

  assert.match(html, /data-testid="tower-node-model">Not available</);
  assert.match(html, /data-testid="tower-node-cost">Not available</);
  // The strongest form of the guard: an absent figure is never a dollar amount,
  // and no surface here sums one.
  assert.doesNotMatch(html, /\$/);
  assert.doesNotMatch(html, /\btotal\b/i);
  assert.doesNotMatch(html, /0 tok/);
});

test("a readable cost is never a bare total", () => {
  const html = render(
    derivePortfolioView(
      snapshot({
        data: [
          line({
            job: "j1",
            role: "builder",
            cost: {
              inputTokens: 1200,
              outputTokens: 300,
              coverage: { observedAgents: 1, totalAgents: 2 },
            },
          }),
        ],
      }),
      () => {},
    ),
  );

  // The readable sum travels with the coverage it was computed over.
  assert.match(html, /1,500 tok · observed 1 of 2 agents/);
  assert.doesNotMatch(html, /\$/);
  assert.doesNotMatch(html, /\btotal\b/i);
});

test("the canvas never claims a blocked state", () => {
  const html = render(
    derivePortfolioView(
      snapshot({
        data: [
          line({ job: "j1", role: "builder" }),
          line({ job: "j2", role: "builder", state: null }),
        ],
      }),
      () => {},
    ),
  );

  assert.doesNotMatch(html, /blocked/i);
  // No state was reported for `j2`, so the card says so instead of borrowing one.
  assert.equal(
    (html.match(/data-testid="tower-node-state">No run reported</g) ?? [])
      .length,
    1,
  );
});

test("a dead source renders the error branch and no cards", async () => {
  const source = createTowerBuzzSource(
    async () => {
      throw new Error("relay unreachable");
    },
    async () => "owner",
  );

  const error = await source.getPortfolio().then(
    () => null,
    (cause) => cause,
  );
  assert.ok(error instanceof TowerSourceError);

  const html = render(
    derivePortfolioView(snapshot({ isError: true, error }), () => {}),
  );

  assert.match(html, /tower-error-state/);
  assert.match(html, /adapter_unavailable/);
  assert.equal(countOf(html, "tower-node"), 0);
  assert.doesNotMatch(html, /tower-empty-state/);
});

test("each surface state carries text: loading and empty are never blank", () => {
  const loading = render(
    derivePortfolioView(snapshot({ isPending: true }), () => {}),
  );
  assert.match(loading, /tower-loading-state/);
  assert.equal(countOf(loading, "tower-node"), 0);
  // One read, one announcement: the panel owns it. A live region here would
  // announce the same `PortfolioView` transition a second time.
  assert.doesNotMatch(loading, /aria-live/);

  const empty = render(derivePortfolioView(snapshot({ data: [] }), () => {}));
  assert.match(empty, /tower-empty-state/);
  assert.match(empty, /No lines to show yet/);
  assert.equal(countOf(empty, "tower-node"), 0);
  assert.doesNotMatch(empty, /aria-live/);
});
