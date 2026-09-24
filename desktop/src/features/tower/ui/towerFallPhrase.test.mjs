import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelSection } from "@/features/panel/ui/PanelSection.tsx";
import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource.ts";
import { GrafoSection } from "./GrafoSection.tsx";
import { deriveHandoverView } from "./handoverState.ts";
import { derivePortfolioView } from "./portfolioState.ts";

/**
 * S4 piece A — one fall phrase per read (design §1.1 rule 2, residual N1).
 *
 * P1/P2/P4 share the portfolio read, so a fall of that read has **one**
 * sentence, whether the operator meets it on the card surface (`GrafoSection` →
 * `TowerStaleBanner`) or in the panel (`PanelSection` → `PanelStaleBanner`).
 * Before this, the two surfaces described the same instant in two languages and
 * two formats — the card printed the raw ISO (`2026-09-23T09:40:00.000Z`), the
 * panel printed `09:40 UTC`.
 *
 * Bound to the production seam: the real adapter (`createTowerBuzzSource`, with
 * injected reads), the real derivation and both real surfaces. A hand-built
 * `PortfolioView` would not see a regression in the adapter, and a single-surface
 * assertion would not see the two surfaces drifting apart — which is the defect
 * this test exists to stop.
 */

const OWNER = "owner-pubkey-hex";
/** The last good read's instant. Its raw ISO must not reach either sentence. */
const READ_AT = "2026-09-23T09:40:00.000Z";
const READ_ISO_PREFIX = "2026-09-23T09:40";

/** A raw job event, as the relay returns it. Its instant is not `READ_AT`, so
 * the row's own «Instante» cell cannot be mistaken for the read's clock. */
function jobEvent({ kind, job, role = "builder", at }) {
  return {
    id: `${job}-${kind}-${at}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", OWNER],
      ["job", job],
      ["role", role],
    ],
  };
}

/** The production read over fixed events. */
function sourceOver(events) {
  return createTowerBuzzSource(
    async () => events,
    async () => OWNER,
  );
}

/** The production read that dies, over a fixed cause. */
function failingSource(cause) {
  return createTowerBuzzSource(
    async () => {
      throw cause;
    },
    async () => OWNER,
  );
}

/** The settled adapter result, driven through the derivation the screens use. */
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

/** The handoff read answered and found nothing: this test is not about it. */
function quietHandovers() {
  return deriveHandoverView(
    {
      isPending: false,
      isFetching: false,
      isError: false,
      data: [],
      dataUpdatedAt: 0,
      error: null,
    },
    () => {},
  );
}

/**
 * The fall notice's sentence, read inside its own notice element. Both notices
 * render it as the first `<span>` of the description; the citable `code` is a
 * separate element, so it is not part of the sentence.
 */
function fallSentence(html, testId) {
  const banner = html.slice(html.indexOf(`data-testid="${testId}"`));
  const match = banner.match(/<span>([\s\S]*?)<\/span>/);
  return match === null ? null : match[1];
}

test("A: a fall over a snapshot names the hour in UTC on both surfaces, with one phrase", async () => {
  const good = await viewFrom(
    sourceOver([jobEvent({ kind: 43002, job: "job-a", at: 100 })]),
  );
  const view = await viewFrom(failingSource(new Error("timeout")), {
    previous: good.lines,
    dataUpdatedAt: Date.parse(READ_AT),
  });
  assert.equal(view.phase, "unreachable", "the read must be the fallen branch");

  const card = renderToStaticMarkup(
    React.createElement(GrafoSection, { view, handovers: quietHandovers() }),
  );
  const panel = renderToStaticMarkup(
    React.createElement(PanelSection, {
      portfolio: view,
      handovers: quietHandovers(),
    }),
  );

  // (i) the read's raw ISO does not reach the operator through either fall
  // notice. (`2026-09-23T09:40` is the last good *read*; the row's own instants
  // are other strings, so this cannot pass by accident.)
  assert.doesNotMatch(card, new RegExp(READ_ISO_PREFIX));
  assert.doesNotMatch(panel, new RegExp(READ_ISO_PREFIX));

  // (ii) both name the hour in the panel's UTC clock.
  assert.match(card, /09:40 UTC/);
  assert.match(panel, /09:40 UTC/);

  // (iii) one phrase per read: the card's sentence and the panel's are equal,
  // normalising only the citable failure code (which is not part of the
  // sentence on either surface).
  const cardSentence = fallSentence(card, "tower-stale-banner");
  const panelSentence = fallSentence(panel, "panel-stale-banner");
  assert.ok(cardSentence, "the card notice must carry its fall sentence");
  assert.equal(
    cardSentence,
    panelSentence,
    "the card and the panel must speak one fall sentence for one read",
  );
  // Pinned literal, so a change to one surface alone cannot pass by matching
  // the other's new text.
  assert.equal(
    cardSentence,
    "Se muestra la última lectura buena, de 09:40 UTC. Las filas de abajo son datos viejos, no actuales.",
  );
});
