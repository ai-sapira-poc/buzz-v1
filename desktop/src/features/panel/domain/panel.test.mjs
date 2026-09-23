import assert from "node:assert/strict";
import test from "node:test";

import { buildPanelRows, orderPanelRows } from "./panel.ts";

function line(overrides = {}) {
  return {
    project: { id: "job-a", name: "coder" },
    recency: { lastSpanAt: new Date(100 * 1000).toISOString() },
    blocked: { count: 0, basis: null },
    cost: null,
    work: { state: "running", summary: "escribiendo el slice" },
    waiting: null,
    ...overrides,
  };
}

function edge(overrides = {}) {
  return {
    id: "parent->job-a",
    sender: { jobId: "parent", name: "architect" },
    child: { jobId: "job-a", name: "coder" },
    parentOutcome: "done",
    transferredAt: new Date(50 * 1000).toISOString(),
    thread: { channel: "panel-agentes", eventId: null },
    ...overrides,
  };
}

test("the recorded wait travels to the panel row, reason and instant", () => {
  const waiting = {
    reason: "ladder_exhausted",
    at: "2026-09-23T09:40:00.000Z",
  };
  const rows = buildPanelRows([line({ waiting })], []);
  assert.deepEqual(rows[0].waiting, waiting);
});

test("a job with no recorded wait reads as null here, never as zero", () => {
  const rows = buildPanelRows([line()], []);
  assert.equal(rows[0].waiting, null);
});

test("the parent edge is joined by the child job id it points at", () => {
  const rows = buildPanelRows(
    [line(), line({ project: { id: "job-b", name: "revisor" } })],
    [edge()],
  );
  const byJob = new Map(rows.map((row) => [row.jobId, row]));
  assert.deepEqual(byJob.get("job-a").parent, {
    jobId: "parent",
    outcome: "done",
  });
  assert.deepEqual(byJob.get("job-a").thread, {
    channel: "panel-agentes",
    eventId: null,
  });
  assert.equal(byJob.get("job-b").parent, null);
});

test("among several edges to one child, the newest readable one wins", () => {
  const rows = buildPanelRows(
    [line()],
    [
      edge({
        id: "old",
        sender: { jobId: "parent-old", name: "architect" },
        transferredAt: new Date(10 * 1000).toISOString(),
      }),
      edge({
        id: "new",
        sender: { jobId: "parent-new", name: "architect" },
        transferredAt: new Date(90 * 1000).toISOString(),
      }),
    ],
  );
  assert.deepEqual(rows[0].parent, { jobId: "parent-new", outcome: "done" });
});

test("the panel row carries no blocked cell at all", () => {
  // The Tower row derives `blocked` from `failed` and paints `0 · observed` on
  // a healthy job. The panel must not be able to inherit it, so the field does
  // not exist here.
  const rows = buildPanelRows([line()], []);
  assert.equal("blocked" in rows[0], false);
});

test("rows with a recorded wait sort ahead of rows without one", () => {
  const rows = orderPanelRows([
    { jobId: "quiet", lastEventAt: null, waiting: null },
    {
      jobId: "resting",
      lastEventAt: null,
      waiting: { reason: "ladder_exhausted", at: "2026-09-23T09:40:00.000Z" },
    },
  ]);
  assert.deepEqual(
    rows.map((row) => row.jobId),
    ["resting", "quiet"],
  );
});

test("an unreadable instant sorts last, not as the oldest time", () => {
  const rows = orderPanelRows([
    { jobId: "unknown", lastEventAt: null, waiting: null },
    {
      jobId: "dated",
      lastEventAt: new Date(1000 * 1000).toISOString(),
      waiting: null,
    },
  ]);
  assert.deepEqual(
    rows.map((row) => row.jobId),
    ["dated", "unknown"],
  );
});
