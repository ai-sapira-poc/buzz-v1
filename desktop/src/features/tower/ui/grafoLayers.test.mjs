import assert from "node:assert/strict";
import test from "node:test";

import {
  computeGrafoLayout,
  GRAFO_CARD_HEIGHT,
  GRAFO_CARD_WIDTH,
  GRAFO_LAYER_GAP,
  GRAFO_LAYER_HEADER_HEIGHT,
  GRAFO_ROW_GAP,
  grafoMetrics,
  layerLabel,
} from "./grafoLayers.ts";

/**
 * D1's falsifier, written down where D left it open: a graph with a cycle and
 * an orphan must be laid out without iterating without a bound, and the
 * un-derivable depth must be marked rather than guessed. Also the two ordering
 * rules D1 diverges on, and the determinism across two reads of the same set.
 */

function line(job, { at = "2026-09-23T20:00:00.000Z", waiting = null } = {}) {
  return {
    project: { id: job, name: job },
    recency: { lastSpanAt: at },
    blocked: { count: 0, basis: null },
    cost: null,
    work: { state: "running", summary: null },
    waiting,
  };
}

function edge(parent, child, { id = null, outcome = "done" } = {}) {
  return {
    id: id ?? `${parent}->${child}`,
    sender: { jobId: parent, name: parent },
    child: { jobId: child, name: child },
    parentOutcome: outcome,
    transferredAt: "2026-09-23T19:00:00.000Z",
    thread: null,
  };
}

function byJob(layout) {
  return Object.fromEntries(layout.nodes.map((node) => [node.jobId, node]));
}

test("a chain is laid out by its longest handoff path", () => {
  const layout = computeGrafoLayout(
    [line("a"), line("b"), line("c")],
    [edge("a", "b"), edge("b", "c")],
  );

  const nodes = byJob(layout);
  assert.deepEqual(
    [nodes.a.x, nodes.b.x, nodes.c.x],
    [
      0,
      GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP,
      2 * (GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP),
    ],
  );
  assert.equal(layout.unknownDepthCount, 0);
  assert.deepEqual(layout.layers.map(layerLabel), [
    "Depth 0",
    "Depth 1",
    "Depth 2",
  ]);
});

test("a node takes the longest path, not the first parent's", () => {
  // a→b→c and a→c: c is depth 2, the longest path, not depth 1.
  const layout = computeGrafoLayout(
    [line("a"), line("b"), line("c")],
    [edge("a", "b"), edge("b", "c"), edge("a", "c")],
  );
  const nodes = byJob(layout);
  assert.equal(nodes.c.x, 2 * (GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP));
});

test("a cycle terminates and its nodes carry no invented depth", () => {
  const layout = computeGrafoLayout(
    [line("a"), line("b")],
    [edge("a", "b"), edge("b", "a")],
  );

  assert.equal(layout.unknownDepthCount, 2);
  assert.deepEqual(layout.layers.map(layerLabel), ["No depth"]);
  // The edge is still a legible edge: only the depth is undecidable.
  assert.equal(layout.edges.length, 2);
  // And the layer's nodes are ordered by jobId, deterministically.
  assert.deepEqual(
    layout.nodes.map((node) => node.jobId),
    ["a", "b"],
  );
});

test("a node downstream of a cycle is also marked, not guessed", () => {
  const layout = computeGrafoLayout(
    [line("x"), line("y"), line("z")],
    [edge("x", "y"), edge("y", "x"), edge("y", "z")],
  );
  assert.equal(layout.unknownDepthCount, 3);
  assert.equal(byJob(layout).z.layerKey, "unknown");
});

test("an edge endpoint outside the window is an orphan node, not a dropped edge", () => {
  const layout = computeGrafoLayout(
    [line("child")],
    [edge("absent-parent", "child")],
  );

  assert.equal(layout.nodes.length, 2);
  const orphan = byJob(layout)["absent-parent"];
  assert.equal(orphan.line, null);
  assert.equal(layout.orphanEdgeCount, 1);
  // The orphan is **not** a node of the window, so it gets no depth at all: a
  // layer would assert a depth nobody published. It rides the no-depth band.
  assert.equal(orphan.layerKey, "unknown");
  assert.equal(orphan.x, GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP);
  // The window's own node keeps the depth its own window's edges give it: the
  // edge that touches the orphan cannot stretch it.
  assert.equal(byJob(layout).child.layerKey, "depth:0");
  assert.equal(byJob(layout).child.x, 0);
  // The band is a real column of the layout, so the world must be as wide as it.
  assert.equal(layout.width, 2 * GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP);
});

test("orphans ride the no-depth band, never a depth layer", () => {
  const layout = computeGrafoLayout(
    [line("middle")],
    [edge("up", "middle"), edge("middle", "down")],
  );

  assert.deepEqual(layout.layers.map(layerLabel), ["Depth 0", "No depth"]);
  const band = layout.layers[layout.layers.length - 1];
  assert.equal(band.depthKnown, false);
  // Two orphans, ordered by jobId — the one identity they all share.
  assert.deepEqual(
    band.nodes.map((node) => node.jobId),
    ["down", "up"],
  );
  assert.equal(layout.unknownDepthCount, 2);
});

test("an orphan carries the role the edge read named, or none at all", () => {
  const named = computeGrafoLayout(
    [line("child")],
    [
      {
        ...edge("absent", "child"),
        sender: { jobId: "absent", name: "arquitecto" },
      },
    ],
  );
  assert.equal(byJob(named).absent.roleHint, "arquitecto");

  const unnamed = computeGrafoLayout(
    [line("child")],
    [
      {
        ...edge("absent", "child"),
        sender: { jobId: "absent", name: null },
      },
    ],
  );
  assert.equal(byJob(unnamed).absent.roleHint, null);
});

test("a later row with no name does not erase a role an earlier one carried", () => {
  const layout = computeGrafoLayout(
    [line("child-a"), line("child-b")],
    [
      {
        ...edge("absent", "child-a"),
        sender: { jobId: "absent", name: "arquitecto" },
      },
      { ...edge("absent", "child-b"), sender: { jobId: "absent", name: null } },
    ],
  );
  assert.equal(byJob(layout).absent.roleHint, "arquitecto");
});

test("an edge with both ends outside the window is still drawn, in the band", () => {
  const layout = computeGrafoLayout(
    [line("unrelated")],
    [edge("left", "right")],
  );

  assert.equal(layout.orphanEdgeCount, 1);
  assert.equal(layout.edges.length, 1);
  assert.deepEqual(layout.layers.map(layerLabel), ["Depth 0", "No depth"]);
  const band = layout.layers[layout.layers.length - 1];
  assert.deepEqual(
    band.nodes.map((node) => node.jobId),
    ["left", "right"],
  );
});

test("a job handing off to itself is not an edge", () => {
  const layout = computeGrafoLayout([line("a")], [edge("a", "a")]);
  assert.equal(layout.edges.length, 0);
  assert.equal(layout.unknownDepthCount, 0);
});

test("a duplicate edge id is one edge, not two", () => {
  const layout = computeGrafoLayout(
    [line("a"), line("b")],
    [edge("a", "b"), edge("a", "b")],
  );
  assert.equal(layout.edges.length, 1);
});

test("within a layer: a recorded wait first, then recency, then jobId", () => {
  const layout = computeGrafoLayout(
    [
      line("old", { at: "2026-09-23T10:00:00.000Z" }),
      line("new", { at: "2026-09-23T12:00:00.000Z" }),
      line("waiting", {
        at: "2026-09-23T09:00:00.000Z",
        waiting: { reason: "ladder_exhausted", at: "2026-09-23T09:00:00.000Z" },
      }),
      line("tie-b", { at: "2026-09-23T12:00:00.000Z" }),
      line("tie-a", { at: "2026-09-23T12:00:00.000Z" }),
    ],
    [],
  );

  assert.deepEqual(
    layout.nodes.map((node) => node.jobId),
    ["waiting", "new", "tie-a", "tie-b", "old"],
  );
  // Vertical positions follow the order, on the fixed row pitch.
  assert.equal(
    layout.nodes[1].y,
    GRAFO_LAYER_HEADER_HEIGHT + (GRAFO_CARD_HEIGHT + GRAFO_ROW_GAP),
  );
});

test("the layout is reproducible across two reads that reorder the input", () => {
  const lines = [line("b"), line("a"), line("c")];
  const edges = [edge("b", "c"), edge("a", "c")];
  const first = computeGrafoLayout(lines, edges);
  const second = computeGrafoLayout([...lines].reverse(), [...edges].reverse());

  assert.deepEqual(
    first.nodes.map((node) => [node.jobId, node.x, node.y]),
    second.nodes.map((node) => [node.jobId, node.x, node.y]),
  );
});

test("the reading order is layer by layer, and the index matches it", () => {
  const layout = computeGrafoLayout(
    [line("a"), line("b"), line("c")],
    [edge("a", "c"), edge("b", "c")],
  );
  assert.deepEqual(
    layout.nodes.map((node) => node.index),
    [0, 1, 2],
  );
  assert.deepEqual(
    layout.nodes.map((node) => node.jobId),
    layout.layers.flatMap((layer) => layer.nodes.map((node) => node.jobId)),
  );
});

test("the grid is the live root font size's, so the boxes are never left behind", () => {
  // The canvas draws `w-64` (16rem) wide, `h-44` (11rem) tall cards with a 1rem
  // row gap under a `h-8` (2rem) heading, but positions them from these px
  // numbers. `Cmd +/-` moves the root through 12px…24px (contract §4.7), so the
  // numbers have to be the root's or the edge stops landing on the card.
  for (const root of [12, 16, 24]) {
    const metrics = grafoMetrics(root);
    assert.equal(metrics.cardWidth, 16 * root, `card width at root ${root}`);
    assert.equal(metrics.cardHeight, 11 * root, `card height at root ${root}`);
    assert.equal(metrics.rowGap, root, `row gap at root ${root}`);
    assert.equal(metrics.headerHeight, 2 * root, `header at root ${root}`);

    const layout = computeGrafoLayout(
      [
        line("a", { at: "2026-09-23T20:00:00.000Z" }),
        line("b", { at: "2026-09-23T19:00:00.000Z" }),
      ],
      [],
      metrics,
    );
    const [first, second] = layout.nodes;
    // One layer, two rows: the layout's own row pitch is what the edge layer
    // reads y from, so it must be the step the flex column takes.
    assert.equal(first.x, 0);
    assert.equal(layout.width, metrics.cardWidth);
    assert.equal(
      second.y - first.y,
      metrics.cardHeight + metrics.rowGap,
      `row pitch at root ${root}`,
    );
  }
});

test("a malformed edge row is skipped, never a half edge", () => {
  const layout = computeGrafoLayout(
    [line("a")],
    [edge("a", "b", { id: "no-child" }), { ...edge("a", "c"), child: {} }],
  );
  // Only the first is a well-formed edge; the second has no readable child.
  assert.deepEqual(
    layout.edges.map((item) => item.id),
    ["no-child"],
  );
  assert.equal(layout.nodes.length, 2);
});
