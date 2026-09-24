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
 * The raw event → the drawn edge, end to end through the production port.
 *
 * Two suites already exist and neither closes this seam.
 * `handoverRender.test.mjs` carries a real `43007` event through the adapter
 * into the handoff **rows** (the relay list, below the canvas), and
 * `towerGrafoRender.test.mjs` renders **seeded** rows into the canvas. Between
 * them sits the one fact S2's acceptance criterion is about: a row a real relay
 * returns actually reaching a `<path>` on the cards, with the parent → child
 * direction the edge carries. Neither existing file fails if the adapter's fold
 * reverses that direction, and a connector drawn on invented geometry passes
 * both.
 *
 * This file is that guard. The raw `kind: 43007` event enters through
 * `createTowerBuzzSource` — never seeded into the canvas — and the assertions
 * read the arrow's own attributes (`data-parent` / `data-child`, confirmed in
 * `GrafoEdges.tsx`), the `marker-end` the arrowhead rides, and the layer the
 * DOM actually placed each endpoint in. Reversing the fold's `job`/`child`
 * read turns every test below red.
 */

/** A lifecycle event — the only kind that turns a job into a window card. */
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

/**
 * A handoff edge, shaped exactly like the produced `kind: 43007`: `job` is the
 * job that handed off (the parent, and the emitter of the `role` tag), `child`
 * is the job it handed off to.
 */
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
 * The production port, with both reads stubbed so each gets the events it reads
 * in production: the portfolio read gets the lifecycle kinds, and the edge read
 * gets the lifecycle kinds **and** the handoff kind (`buildHandoffEventFilter`
 * — the parent's outcome is joined from the same read).
 */
function sourceOver(portfolioEvents, handoffEvents) {
  return createTowerBuzzSource(
    async () => portfolioEvents,
    async () => "owner",
    async () => handoffEvents,
  );
}

/** The canvas, over both views the adapter just produced. */
async function renderCanvas(source) {
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

/** Every drawn arrow, as its own attribute map — read off the `<path>` tag. */
function drawnEdges(html) {
  const tags =
    html.match(/<path[^>]*data-testid="tower-grafo-edge"[^>]*>/g) ?? [];
  return tags.map((tag) => {
    const open = tag.slice(0, tag.indexOf(">") + 1);
    return Object.fromEntries(
      [...open.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
  });
}

/**
 * The world's layers, in document order, each bounded by the next one.
 *
 * The bound is the assertion: a card found inside layer 0's segment but drawn
 * in layer 1 would make the containment checks below vacuously true. `left` is
 * the layer's own offset, from its own opening tag — React drops the unit on a
 * zero, so `left:0` and `left:352px` are both left offsets.
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
    const open = segment.slice(0, segment.indexOf(">") + 1);
    const left = open.match(/style="left:(-?[0-9.]+)(?:px)?[;"]/);
    return {
      left: left === null ? Number.NaN : Number(left[1]),
      title:
        segment.match(
          /data-testid="tower-grafo-layer-title"[^>]*>([^<]+)</,
        )?.[1] ?? null,
      html: segment,
    };
  });
}

/** The role printed by the one card an edge endpoint outside the window got. */
function orphanCardRole(html) {
  const starts = [];
  for (
    let at = html.indexOf("<li");
    at !== -1;
    at = html.indexOf("<li", at + 1)
  ) {
    starts.push(at);
  }
  for (const [index, start] of starts.entries()) {
    const segment = html.slice(start, starts[index + 1] ?? html.length);
    const open = segment.slice(0, segment.indexOf(">") + 1);
    if (
      open.includes('data-orphan="true"') &&
      open.includes('data-testid="tower-node"')
    ) {
      return (
        segment.match(/data-testid="tower-node-role"[^>]*>([^<]*)</)?.[1] ??
        null
      );
    }
  }
  return undefined;
}

test("a raw 43007 read by the adapter is drawn parent → child on the canvas", async () => {
  const lifecycle = [
    lifecycleEvent({
      kind: 43002,
      job: "tower-architect",
      role: "architect",
      at: 90,
    }),
    lifecycleEvent({ kind: 43002, job: "tower-coder", role: "coder", at: 95 }),
  ];
  const source = sourceOver(lifecycle, [
    ...lifecycle,
    handoffEvent({
      parent: "tower-architect",
      child: "tower-coder",
      role: "architect",
      at: 100,
    }),
  ]);

  const html = await renderCanvas(source);
  const edges = drawnEdges(html);

  // The edge the relay's event describes exists, and it is one edge — not an
  // `<svg>` that happens to be present.
  assert.equal(edges.length, 1);
  const [edge] = edges;
  // `data-parent`/`data-child` are the arrow's own direction, and the tag that
  // reads `job` first must be the one that ends up as the parent.
  assert.equal(edge["data-parent"], "tower-architect");
  assert.equal(edge["data-child"], "tower-coder");
  // The arrowhead (`marker-end`) rides the child's end of the path.
  assert.match(edge["marker-end"], /^url\(#tower-grafo-arrow-/);

  // …and the drawn direction is the derived one, not just the attribute: the
  // parent's card is in the first layer, the child's in the second.
  const drawn = layers(html);
  assert.deepEqual(
    drawn.map((layer) => layer.title),
    ["Depth 0", "Depth 1"],
  );
  assert.match(drawn[0].html, /tower-architect/);
  assert.doesNotMatch(drawn[0].html, /tower-coder/);
  assert.match(drawn[1].html, /tower-coder/);

  // The endpoints are the borders of the cards the DOM actually placed: the
  // path starts at the parent layer's right border and ends at the child
  // layer's left border. Geometry that drifted off its layer fails here.
  assert.equal(Number(edge["data-x1"]), drawn[0].left + GRAFO_CARD_WIDTH);
  assert.equal(Number(edge["data-x2"]), drawn[1].left);
  assert.ok(
    Number(edge["data-x2"]) > Number(edge["data-x1"]),
    "the arrow must run left to right, parent to child",
  );
  // The edge layer is inside the transformed world with the cards, not beside
  // it — that is what keeps the arrowhead on its card under pan or zoom.
  assert.equal(
    (html.match(/data-testid="tower-grafo-edge-layer"/g) ?? []).length,
    1,
  );
});

test("a chain of edges keeps every link's direction", async () => {
  const lifecycle = [
    lifecycleEvent({
      kind: 43002,
      job: "tower-architect",
      role: "architect",
      at: 90,
    }),
    lifecycleEvent({ kind: 43002, job: "tower-coder", role: "coder", at: 95 }),
    lifecycleEvent({
      kind: 43002,
      job: "tower-reviewer",
      role: "reviewer",
      at: 97,
    }),
  ];
  const source = sourceOver(lifecycle, [
    ...lifecycle,
    handoffEvent({ parent: "tower-architect", child: "tower-coder", at: 100 }),
    handoffEvent({ parent: "tower-coder", child: "tower-reviewer", at: 101 }),
  ]);

  const html = await renderCanvas(source);

  // Both links are drawn, each naming its own endpoints — a fold that collapsed
  // or reversed a link fails on the pair, not just on the count.
  const pairs = drawnEdges(html)
    .map((edge) => [edge["data-parent"], edge["data-child"]])
    .sort();
  assert.deepEqual(pairs, [
    ["tower-architect", "tower-coder"],
    ["tower-coder", "tower-reviewer"],
  ]);
  // The chain is three depths, so no two links collapsed onto one layer.
  assert.deepEqual(
    layers(html).map((layer) => layer.title),
    ["Depth 0", "Depth 1", "Depth 2"],
  );
});

test("the child's role comes from the edge read, never from the emitter", async () => {
  // The child has no line in the portfolio window, so it is an orphan card —
  // named by the edge read's own lifecycle event for the child (`43004`), not
  // by the `role` tag the 43007 carries, which names the **emitter**, the
  // parent. Borrowing it would print "architect" on the child's card.
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

  const html = await renderCanvas(source);
  const edges = drawnEdges(html);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]["data-child"], "tower-coder");
  assert.equal(edges[0]["data-orphan"], "true");

  const role = orphanCardRole(html);
  assert.equal(role, "reviewer");
  assert.notEqual(role, "architect");
});

test("an edge read that names only the parent leaves the child named, not blank", async () => {
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

  const html = await renderCanvas(source);
  // The unnamed endpoint is still drawn, and it says so with the surface's own
  // placeholder rather than an empty cell or the parent's role.
  assert.equal(orphanCardRole(html), "Unnamed agent");
});
