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

/**
 * The role text of each card, read **inside the card element**.
 *
 * The scoping is the assertion: `tower-node-role` rendered anywhere else (an
 * attention band, the portfolio row, the handoff section) is not the guarantee
 * S1-2 needs. D1 removed the column per role, so the role has no heading left
 * to live in — it must ride the card, and this reads it there. A card that lost
 * the label reports `null`, so moving the role off the card fails here even if
 * some other surface still prints it.
 */
function cardRoles(html) {
  return html
    .split('data-testid="tower-node"')
    .slice(1)
    .map((card) => {
      const match = card.match(/data-testid="tower-node-role"[^>]*>([^<]*)</);
      return match === null ? null : match[1];
    });
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

test("the role rides each card, read from the card itself", () => {
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
  // live in and rides the card. Read per card: deleting the label from the card
  // fails here even if it survives in some other surface's markup.
  assert.equal(cardRoles(html).length, countOf(html, "tower-node"));
  assert.deepEqual(cardRoles(html), ["builder", "Unnamed agent"]);
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

/* -------------------------------------------------------------------------
 * The portfolio-read fall on the card surface (P1) and its grouping (P4).
 *
 * The tests below bind the whole seam — the real adapter, the real derivation
 * and the real section — because `events ?? []` used to resolve a rejected read
 * as a successful empty one, and a test that hands the error in as a prop
 * cannot see that. `derivePortfolioView` is fed what React Query actually
 * delivers when the read rejects: `isError` with the `data` it still holds.
 * ---------------------------------------------------------------------- */

/** The production read over fixed events. */
function sourceOver(events) {
  return createTowerBuzzSource(
    async () => events,
    async () => "owner",
  );
}

/** The production read that dies, over a fixed cause. */
function failingSource(cause) {
  return createTowerBuzzSource(
    async () => {
      throw cause;
    },
    async () => "owner",
  );
}

/**
 * Drives the settled adapter result through the derivation the screen uses.
 * `previous`/`dataUpdatedAt` are what React Query still holds from an earlier
 * read when a refetch fails.
 */
async function viewFrom(source, { previous, dataUpdatedAt = 0 } = {}) {
  const settled = await source.getPortfolio().then(
    (data) => ({ data, cause: null }),
    (cause) => ({ data: undefined, cause }),
  );
  return derivePortfolioView(
    {
      isPending: false,
      isFetching: false,
      isError: settled.cause !== null,
      data: settled.data ?? previous,
      dataUpdatedAt,
      error: settled.cause,
    },
    () => {},
  );
}

test("P1 pair: a rejected read is the fall notice, never an empty canvas", async () => {
  // The lie this pair exists to stop: a dead read resolving as a list, so the
  // surface borrows the successful empty read's meaning and the card's absence
  // vocabulary (taxonomy §9) instead of saying the read failed.
  const view = await viewFrom(failingSource(new Error("relay unreachable")));
  const html = render(view);

  // The false empty comes first, so a regression reports the lie it drew rather
  // than a phase mismatch: with the rejected read resolved as a list, this is
  // the empty canvas, and the fall notice is nowhere.
  assert.doesNotMatch(html, /tower-empty-state/);
  assert.match(html, /tower-error-state/);
  assert.match(html, /adapter_unavailable/);
  assert.doesNotMatch(html, /tower-stale-banner/);
  assert.equal(countOf(html, "tower-node"), 0);
  assert.doesNotMatch(html, /No run reported/);
  assert.doesNotMatch(html, /No signal/);
  // R7: no figure travels under a fall.
  assert.doesNotMatch(html, /tok/);
  assert.equal(view.phase, "unreachable");
});

test("P1 pair: a healthy read with no jobs is the empty canvas, not a fall", async () => {
  // The other half of the pair, with its own cross-absence assertion: the case
  // above would also pass if the section painted the fall notice over every
  // read, so this one denies the notice on the healthy empty read.
  const view = await viewFrom(sourceOver([]));
  const html = render(view);

  assert.equal(view.phase, "ready");
  assert.match(html, /tower-empty-state/);
  assert.doesNotMatch(html, /tower-error-state/);
  assert.doesNotMatch(html, /tower-stale-banner/);
});

test("P1: a rejection after a good read keeps the cards and names the instant", async () => {
  const good = await viewFrom(
    sourceOver([
      jobEvent({ kind: 43002, job: "job-a", role: "builder", at: 100 }),
    ]),
  );
  const readAt = Date.parse("2026-09-23T09:40:00.000Z");
  const view = await viewFrom(failingSource(new Error("timeout")), {
    previous: good.lines,
    dataUpdatedAt: readAt,
  });
  const html = render(view);

  assert.equal(view.phase, "unreachable");
  // D-9: the snapshot is not unmounted under a fall.
  assert.match(html, /tower-stale-banner/);
  assert.equal(countOf(html, "tower-node"), 1);
  assert.doesNotMatch(html, /tower-error-state/);
  // §1 P1: the notice names when the last good read happened — as the read
  // carried it, not as an age computed against the render's clock — and cites
  // the adapter's code. No figure rides the notice.
  assert.match(html, /2026-09-23T09:40:00\.000Z/);
  assert.match(html, /code: adapter_unavailable/);
  assert.doesNotMatch(html, /tok/);
  // One retry, inside the notice, and no way to dismiss it. The canvas keeps
  // its own zoom controls on this branch, so the count of buttons is not the
  // assertion — the notice's only action is the one that matters.
  assert.equal((html.match(/Retry/g) ?? []).length, 1);
  assert.doesNotMatch(html, /aria-label="[^"]*[Cc]errar/);
  assert.doesNotMatch(html, /aria-label="[^"]*[Dd]escartar/);
  assert.doesNotMatch(html, /aria-label="[^"]*[Cc]lose/);
});

test("P4: the grouping label is permanent, and nothing is grouped over a fall", async () => {
  const fallenWithoutSnapshot = await viewFrom(failingSource(new Error("x")));
  const fallenWithSnapshot = await viewFrom(failingSource(new Error("x")), {
    previous: [],
    dataUpdatedAt: 1,
  });
  // P4's label is permanent (D4-4): it must survive every read state, including
  // both fall branches, or the operator cannot tell what the columns are.
  const states = [
    derivePortfolioView(snapshot({ isPending: true }), () => {}),
    derivePortfolioView(snapshot({ data: [] }), () => {}),
    fallenWithoutSnapshot,
    fallenWithSnapshot,
  ];
  for (const state of states) {
    const html = render(state);
    assert.match(html, /tower-grafo-grouping-note/);
    // And it still names the grouping it labels. The shipped grouping is the
    // handoff depth in this window (D1, `grafoLayers.ts`); S1's column per role
    // was removed by `8247f7d8a`, so the role literal D4-4 drafted has no
    // grouping left to label and must not be printed over this one.
    assert.match(html, /depth in this window/);
    assert.doesNotMatch(html, /Agrupado por rol/);
  }

  // On a fall with no snapshot the read is declared, and no layer and no card
  // exist to group: the grouping is not drawn over a read that never happened.
  // The empty canvas is denied here too, because a dead read resolved as a list
  // is the regression this pair exists to stop — on P4's route, the same one
  // P1 walks.
  const fallen = render(fallenWithoutSnapshot);
  assert.match(fallen, /tower-error-state/);
  assert.doesNotMatch(fallen, /tower-empty-state/);
  assert.equal(countOf(fallen, "tower-grafo-layer"), 0);
  assert.equal(countOf(fallen, "tower-node"), 0);

  // With a snapshot the last good read is kept under the fall notice (D-9), so
  // what is grouped is that read — never the failed one.
  const kept = render(fallenWithSnapshot);
  assert.match(kept, /tower-stale-banner/);
  assert.doesNotMatch(kept, /tower-error-state/);
});
