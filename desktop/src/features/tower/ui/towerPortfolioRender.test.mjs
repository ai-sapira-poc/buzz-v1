import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TowerSourceError } from "../domain/TowerSource.ts";
import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource";
import { derivePortfolioView } from "./portfolioState.ts";
import { TowerSection } from "./TowerSection.tsx";

/**
 * End-to-end through the port: the real Buzz adapter reads projects, and the
 * section renders them. This binds the three seams the unit tests cover
 * separately (adapter → domain → view) so a break in any one of them fails
 * here instead of only in the app.
 */
function project(overrides = {}) {
  return {
    id: "project-a",
    name: "Project A",
    dtag: "project-a",
    description: "",
    owner: "owner",
    createdAt: 1_700_000_000,
    projectChannelId: null,
    relatedChannelIds: [],
    status: "active",
    projectAddress: "30621:owner:project-a",
    primaryRepositoryAddress: null,
    repositoryAddresses: [],
    repositories: [],
    legacy: false,
    ...overrides,
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

test("real project data renders as portfolio rows, not as empty or error", async () => {
  const source = createTowerBuzzSource(async () => [
    project({ id: "buzz-autonomy", name: "buzz-autonomy" }),
    project({ id: "npl-mp", name: "npl-mp" }),
  ]);

  const lines = await source.getPortfolio();
  const view = derivePortfolioView(snapshot({ data: lines }), () => {});
  const html = renderToStaticMarkup(
    React.createElement(TowerSection, { view }),
  );

  assert.match(html, /buzz-autonomy/);
  assert.match(html, /npl-mp/);
  assert.doesNotMatch(html, /tower-empty-state/);
  assert.doesNotMatch(html, /tower-error-state/);
  // What the adapter cannot source is shown as absent, never as a measured zero.
  assert.match(html, /Unknown/);
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /0 tok/);
});

test("a dead source renders the error branch and no rows", async () => {
  const source = createTowerBuzzSource(async () => {
    throw new Error("relay unreachable");
  });

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
