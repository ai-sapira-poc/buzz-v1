import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TowerSourceError } from "../domain/TowerSource.ts";
import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource";
import { derivePortfolioView } from "./portfolioState.ts";
import { TowerSection } from "./TowerSection.tsx";

/**
 * End-to-end through the port: the real Buzz adapter reads agent work, and the
 * section renders it. This binds the three seams the unit tests cover
 * separately (adapter → domain → view) so a break in any one of them fails
 * here instead of only in the app.
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

test("real agent work renders as portfolio rows, not as empty or error", async () => {
  const source = createTowerBuzzSource(
    async () => [
      jobEvent({ kind: 43002, job: "buzz-autonomy", role: "builder", at: 100 }),
      jobEvent({
        kind: 43001,
        job: "npl-mp",
        role: "reviewer",
        at: 90,
      }),
    ],
    async () => "owner",
  );

  const lines = await source.getPortfolio();
  const view = derivePortfolioView(snapshot({ data: lines }), () => {});
  const html = renderToStaticMarkup(
    React.createElement(TowerSection, { view }),
  );

  assert.match(html, /buzz-autonomy/);
  assert.match(html, /npl-mp/);
  assert.doesNotMatch(html, /tower-empty-state/);
  assert.doesNotMatch(html, /tower-error-state/);
  assert.match(html, /Running/);
  assert.match(html, /Requested/);
  // What the adapter cannot source is shown as absent, never as a measured zero.
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /0 tok/);
});

test("a dead source renders the error branch and no rows", async () => {
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

  const view = derivePortfolioView(
    snapshot({ isError: true, error }),
    () => {},
  );
  const html = renderToStaticMarkup(
    React.createElement(TowerSection, { view }),
  );

  assert.match(html, /tower-error-state/);
  assert.match(html, /adapter_unavailable/);
  assert.doesNotMatch(html, /tower-portfolio-row/);
  assert.doesNotMatch(html, /tower-empty-state/);
});
