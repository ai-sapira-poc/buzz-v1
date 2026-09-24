import assert from "node:assert/strict";
import test from "node:test";

import {
  computeGrafoLayout,
  GRAFO_CARD_HEIGHT,
  GRAFO_CARD_WIDTH,
  GRAFO_LAYER_GAP,
  GRAFO_LAYER_HEADER_HEIGHT,
  GRAFO_ROW_GAP,
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
  // The orphan is a root of the window (no incoming edge), so it lands at depth 0.
  assert.equal(orphan.x, 0);
  assert.equal(byJob(layout).child.x, GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP);
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
