import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createTowerBuzzSource } from "@/shared/api/towerBuzzSource";
import { GrafoSection } from "./GrafoSection.tsx";
import { deriveHandoverView } from "./handoverState.ts";
import { GRAFO_CARD_WIDTH } from "./grafoLayers.ts";
import { derivePortfolioView } from "./portfolioState.ts";

/**
 * End to end through the port for **the edge itself**: a real handoff event read
 * by the real Buzz adapter, folded to rows, laid out, and drawn as an arrow on
 * the card it belongs to.
 *
 * The acceptance criterion of this stage — the connected cards show the handoff
 * edge with parent → child direction — rests on a seam that neither existing
 * suite closes. `handoverRender.test.mjs` carries a real `43007` event through
 * the adapter into the handoff **rows**, and `towerGrafoRender.test.mjs` renders
 * seeded rows into the canvas; neither fails if the row a real relay returns
 * stops reaching a `<path>`, and a connector drawn on invented geometry passes
 * both. This is that seam, and it is the guard that fails when the arrow's
 * direction is reversed, when its endpoints leave the cards the DOM placed, or
 * when an orphan loses the role the edge read carried.
 *
 * It supersedes nothing: no file of the previous stage is touched, and the
 * fixtures below are the adapter's own input, not the canvas's.
 */

/** A lifecycle event — the only kind that makes a job a card in the window. */
function lifecycleEvent({ kind, job, role, at }) {
  return {
    id: `${job}-${kind}-${at}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", "owner"],
      ["job", job],
      ["role", role],
    ],
  };
}

/** A handoff edge: `job` handed off to `child`. */
function handoffEvent({ parent, child, role, at = 100 }) {
  return {
    id: `${parent}->${child}`,
    pubkey: "agent",
    kind: 43007,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", "owner"],
      ["h", "chan-1"],
      ["job", parent],
      ["child", child],
      ...(role === undefined ? [] : [["role", role]]),
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

/**
 * The port with both of its reads stubbed, so each gets exactly the events it
 * reads in production: the portfolio reader gets lifecycle events and the edge
 * reader gets handoff edges. Feeding one array to both would depend on the fold
 * ignoring a kind it does not own, which is a property of today's fold, not of
 * the seam this file guards.
 */
function sourceOver(portfolioEvents, handoffEvents) {
  return createTowerBuzzSource(
    async () => portfolioEvents,
    async () => "owner",
    async () => handoffEvents,
  );
}

/** The section, over both views the adapter just produced. */
async function renderSource(source) {
  const [lines, rows] = await Promise.all([
    source.getPortfolio(),
    source.getHandovers(),
  ]);
  return renderToStaticMarkup(
    React.createElement(GrafoSection, {
      view: derivePortfolioView(snapshot({ data: lines }), () => {}),
      handovers: deriveHandoverView(snapshot({ data: rows }), () => {}),
    }),
  );
}

function countOf(html, testId) {
  return (html.match(new RegExp(`data-testid="${testId}"`, "g")) ?? []).length;
}

/** The attributes of one element's opening tag, as a map. */
function attrsOf(segment) {
  const tag = segment.slice(0, segment.indexOf(">") + 1);
  return Object.fromEntries(
    [...tag.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

/**
 * Every card element, as its attribute map plus its own markup.
 *
 * Scoped to `<li`, not to the `data-orphan` marker: the drawn edge carries that
 * marker too, so slicing from its first occurrence would read the arrow's own
 * attributes as if they were the orphan card's — the containment assertions
 * below would then be about the wrong element.
 */
function cards(html) {
  const starts = [];
  for (
    let at = html.indexOf("<li");
    at !== -1;
    at = html.indexOf("<li", at + 1)
  ) {
    starts.push(at);
  }
  return starts.map((start, index) => {
    const segment = html.slice(start, starts[index + 1] ?? html.length);
    return { attrs: attrsOf(segment), html: segment };
  });
}

/** The card drawn for an edge endpoint with no line in the window. */
function orphanCard(html) {
  const orphan = cards(html).find(
    (card) =>
      card.attrs["data-orphan"] === "true" &&
      card.attrs["data-testid"] === "tower-node",
  );
  assert.ok(
    orphan,
    "no orphan card was drawn for the endpoint outside the window",
  );
  return orphan;
}

/** The role text a card prints. */
function cardRole(card) {
  return (
    card.html.match(/data-testid="tower-node-role"[^>]*>([^<]*)</)?.[1] ?? null
  );
}

/** Every drawn arrow, as its attribute map. */
function arrows(html) {
  const tags =
    html.match(/<path[^>]*data-testid="tower-grafo-edge"[^>]*>/g) ?? [];
  return tags.map(attrsOf);
}

/**
 * The world's layers in document order, each **bounded by the next one**.
 *
 * Slicing to the end of the markup would let a card in layer 0 be found in
 * layer 0's segment while actually living in layer 1 — the containment
 * assertions below would then be vacuously true.
 */
function layers(html) {
  const marker = 'data-testid="tower-grafo-layer"';
  const starts = [];
  for (
    let at = html.indexOf(marker);
    at !== -1;
    at = html.indexOf(marker, at + 1)
  ) {
    starts.push(at);
  }
  return starts.map((start, index) => {
    const segment = html.slice(start, starts[index + 1] ?? html.length);
    return {
      // The layer's own left offset, as the DOM received it. React drops the
      // unit on a zero, so `left:0` and `left:352px` are both left offsets.
      left: Number(
        segment.match(/style="left:(-?[0-9.]+)(?:px)?[;"]/)?.[1] ?? Number.NaN,
      ),
      title:
        segment.match(
          /data-testid="tower-grafo-layer-title"[^>]*>([^<]+)</,
        )?.[1] ?? null,
      html: segment,
    };
  });
}

test("a handoff edge read by the adapter is drawn parent → child, on its cards", async () => {
  const source = sourceOver(
    [
      lifecycleEvent({
        kind: 43002,
        job: "tower-architect",
        role: "architect",
        at: 90,
      }),
      lifecycleEvent({
        kind: 43002,
        job: "tower-coder",
        role: "coder",
        at: 95,
      }),
    ],
    [
      handoffEvent({
        parent: "tower-architect",
        child: "tower-coder",
        role: "architect",
        at: 100,
      }),
    ],
  );

  const html = await renderSource(source);

  const drawn = arrows(html);
  assert.equal(drawn.length, 1);
  const [edge] = drawn;
  // The direction, as the arrow's own attributes: the parent is the job that
  // handed off, the child is the one it handed off to, and the arrowhead
  // (`marker-end`) sits at the child's end of the path.
  assert.equal(edge["data-parent"], "tower-architect");
  assert.equal(edge["data-child"], "tower-coder");
  assert.match(edge["marker-end"], /^url\(#tower-grafo-arrow-/);

  // …and the drawn direction is the derived one: the parent's card is in the
  // first layer and the child's in the second, so the arrow cannot point back.
  const drawnLayers = layers(html);
  assert.deepEqual(
    drawnLayers.map((layer) => layer.title),
    ["Depth 0", "Depth 1"],
  );
  assert.match(drawnLayers[0].html, /tower-architect/);
  assert.doesNotMatch(drawnLayers[0].html, /tower-coder/);
  assert.match(drawnLayers[1].html, /tower-coder/);

  // The endpoints are the borders of the cards the DOM actually placed: the
  // arrow starts at the parent layer's right edge and ends at the child layer's
  // left edge. Geometry that drifts from the layer it belongs to fails here.
  assert.equal(Number(edge["data-x1"]), drawnLayers[0].left + GRAFO_CARD_WIDTH);
  assert.equal(Number(edge["data-x2"]), drawnLayers[1].left);
  // The edge layer is in the world with the cards, not beside it.
  assert.equal(countOf(html, "tower-grafo-edge-layer"), 1);
});

test("an endpoint outside the window is drawn in the band, with the role the edge read carried", async () => {
  // The child has no line in the portfolio window — but the edge read did carry
  // its role, in the child's own lifecycle event. That is how the adapter names
  // a child (`rolesByJob` in `towerHandoffEdges`): the `role` tag on the edge
  // names its **emitter**, the parent, never the child.
  const source = sourceOver(
    [
      lifecycleEvent({
        kind: 43002,
        job: "tower-architect",
        role: "architect",
        at: 90,
      }),
    ],
    [
      lifecycleEvent({
        kind: 43004,
        job: "tower-coder",
        role: "reviewer",
        at: 95,
      }),
      handoffEvent({
        parent: "tower-architect",
        child: "tower-coder",
        role: "architect",
        at: 100,
      }),
    ],
  );

  const html = await renderSource(source);

  const drawn = arrows(html);
  assert.equal(drawn.length, 1);
  // The child is the half that has no line in this window, so the edge is the
  // orphan one — and it is still drawn, not dropped.
  assert.equal(drawn[0]["data-orphan"], "true");
  assert.equal(drawn[0]["data-parent"], "tower-architect");
  assert.equal(drawn[0]["data-child"], "tower-coder");

  assert.deepEqual(
    layers(html).map((layer) => layer.title),
    ["Depth 0", "No depth"],
  );

  // The orphan's card: named by the edge, carrying the role **the edge read
  // carried**, and the placeholder for everything this surface never had.
  const orphan = orphanCard(html);
  assert.match(orphan.html, /tower-coder/);
  assert.equal(cardRole(orphan), "reviewer");
  assert.match(
    orphan.html,
    /data-testid="tower-node-state"[^>]*>No run reported</,
  );
  assert.doesNotMatch(orphan.html, /\$/);
});

test("an edge whose read names only the parent leaves the child unnamed, never blank", async () => {
  // The producer's real shape: a `role` tag on the edge names the parent, and
  // nothing in this read names the child. The card is still drawn, and the name
  // it cannot have is stated with the placeholder the surface already uses.
  const source = sourceOver(
    [
      lifecycleEvent({
        kind: 43002,
        job: "tower-architect",
        role: "architect",
        at: 90,
      }),
    ],
    [
      handoffEvent({
        parent: "tower-architect",
        child: "tower-coder",
        role: "architect",
        at: 100,
      }),
    ],
  );

  const html = await renderSource(source);

  // One window card and one orphan: the unnamed endpoint is drawn, not dropped.
  assert.equal(countOf(html, "tower-node"), 2);
  const orphan = orphanCard(html);
  assert.match(orphan.html, /tower-coder/);
  assert.equal(cardRole(orphan), "Unnamed agent");
  // The parent's own role is not borrowed for the child.
  assert.notEqual(cardRole(orphan), "architect");
});
