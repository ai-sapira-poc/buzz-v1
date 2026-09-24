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

/**
 * The edge read with nothing in it — the only read that may mean "no edges".
 *
 * `GrafoSection` takes its edge read as a **required** prop (an omitted reader
 * must not render as "there are no handoffs"), so this fixture is the
 * mechanical consequence of that contract, not a second assertion.
 */
const EMPTY_EDGE_READ = {
  phase: "ready",
  lines: [],
  lastSuccessAt: "2026-09-23T20:00:00.000Z",
  failure: null,
  refreshing: false,
  retry: () => {},
};

function render(view, handovers = EMPTY_EDGE_READ) {
  return renderToStaticMarkup(
    React.createElement(GrafoSection, { view, handovers }),
  );
}

function countOf(html, testId) {
  return (html.match(new RegExp(`data-testid="${testId}"`, "g")) ?? []).length;
}

function layerTitles(html) {
  const titles = [];
  const pattern = /data-testid="tower-grafo-layer-title"[^>]*>([^<]+)<\/h3>/g;
  for (const match of html.matchAll(pattern)) {
    titles.push(match[1]);
  }
  return titles;
}

test("real agent work renders as one card per job in the depth layout", async () => {
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
  // S1-1: the grouping is no longer the role. D1 groups by depth, and with no
  // handoff edge in this read every node is a root *of this window*: one layer.
  assert.deepEqual(layerTitles(html), ["Depth 0"]);
  assert.doesNotMatch(html, /tower-empty-state/);
  assert.doesNotMatch(html, /tower-error-state/);
  assert.match(html, /Running/);
  // `requested` (43001) has no caller emitting it today, so S1 does not draw it
  // as a state: the seeded line is a fixture, not a producer, and its chip
  // names the absence instead (taxonomy §9). `Requested` is exactly what must
  // not render — reverting the removal turns this red.
  assert.doesNotMatch(html, /Requested/);
  assert.match(html, /data-testid="tower-node-state">No signal</);
  // Nor does an unproduced state borrow a produced state's colour.
  assert.doesNotMatch(html, /border-l-sky-500/);
  // The producer's own line rides the card; nothing is invented for the rest.
  assert.match(html, /drawing cards/);
});

test("the grouping is depth in this window, and says so", () => {
  const html = render(
    derivePortfolioView(
      snapshot({ data: [line({ job: "j1", role: "builder" })] }),
      () => {},
    ),
  );

  assert.match(html, /tower-grafo-grouping-note/);
  // S1-4: the note says what a layer is, and that it is not an absolute level.
  assert.match(html, /depth in this window/);
  assert.match(html, /not an absolute hierarchy/);
  // S1-3, strengthened rather than deleted: with the edge read empty there is
  // no edge element at all, so a connector invented by the layout still cannot
  // pass this line.
  assert.equal(countOf(html, "tower-grafo-edge"), 0);
});

test("the role rides every card, and a nameless line gets the placeholder", () => {
  const html = render(
    derivePortfolioView(
      snapshot({
        data: [
          line({ job: "j1", role: "builder" }),
          line({ job: "j2", role: "" }),
        ],
      }),
      () => {},
    ),
  );

  // S1-2: D1 removed the column per role, so the role has no heading left to
  // live in and rides the card. This is the substitute assertion for the frozen
  // line S1-2 lost; deleting the label fails here.
  const roles = [
    ...html.matchAll(/data-testid="tower-node-role"[^>]*>([^<]*)</g),
  ].map((match) => match[1]);
  assert.deepEqual(roles, ["builder", "Unnamed agent"]);
});

test("a line with no role is drawn, never dropped", () => {
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
  // S1-1, second site: the placeholder is still drawn — it now rides the card.
  assert.deepEqual(layerTitles(html), ["Depth 0"]);
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
