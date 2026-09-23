import assert from "node:assert/strict";
import test from "node:test";

import { foldWaitingForJob } from "./towerJobWaiting.ts";
import { createTowerBuzzSource } from "./towerBuzzSource.ts";

const LIFECYCLE = 43003; // kind 43003 — progress
const WAITING = 43008;

function event({ kind, job, at, reason, role, tags = [] }) {
  const built = [
    ["p", "owner"],
    ["job", job],
  ];
  if (reason !== undefined) built.push(["reason", reason]);
  if (role !== undefined) built.push(["role", role]);
  return {
    id: `${job}-${kind}-${at}-${reason ?? ""}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [...built, ...tags],
  };
}

test("a wait beaten by a lifecycle event in the same second is dropped", () => {
  // Case 1: the movement wins the tie. Never affirm a wait that cannot be told
  // apart from a resumption.
  const { waiting } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100, reason: "ladder_exhausted" }),
    event({ kind: LIFECYCLE, job: "j1", at: 100 }),
  ]);
  assert.deepEqual(waiting, []);
});

test("a wait beaten by a later lifecycle event is dropped", () => {
  // Case 2.
  const { waiting } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100, reason: "ladder_exhausted" }),
    event({ kind: LIFECYCLE, job: "j1", at: 101 }),
  ]);
  assert.deepEqual(waiting, []);
});

test("a wait after the last lifecycle event survives, with its reason and instant", () => {
  const { waiting } = foldWaitingForJob([
    event({ kind: LIFECYCLE, job: "j1", at: 100 }),
    event({
      kind: WAITING,
      job: "j1",
      at: 200,
      reason: "capability_denied",
      role: "coder",
    }),
  ]);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].jobId, "j1");
  assert.equal(waiting[0].reason, "capability_denied");
  assert.equal(waiting[0].role, "coder");
  assert.equal(waiting[0].at, new Date(200 * 1000).toISOString());
});

test("two waits of one job yield one entry: the newest wins", () => {
  // Case 3: one cell, not two.
  const { waiting } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100, reason: "ladder_exhausted" }),
    event({ kind: WAITING, job: "j1", at: 150, reason: "capability_denied" }),
  ]);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].reason, "capability_denied");
  assert.equal(waiting[0].at, new Date(150 * 1000).toISOString());
});

test("a wait beaten by a newer terminal is dropped", () => {
  // Case 4: a done job is not at rest.
  const RESULT = 43004;
  const { waiting } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100, reason: "ladder_exhausted" }),
    event({ kind: RESULT, job: "j1", at: 120 }),
  ]);
  assert.deepEqual(waiting, []);
});

test("a wait for a job with no lifecycle event in the read is reported, not discarded", () => {
  // Case 5: born of a failure that already happens — a publication that dies on
  // a relay error leaves the wait with no lifecycle event around it.
  const { waiting, dropped } = foldWaitingForJob([
    event({
      kind: WAITING,
      job: "orphan",
      at: 100,
      reason: "ladder_exhausted",
      role: "architect",
    }),
  ]);
  assert.equal(dropped, 0);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].jobId, "orphan");
  assert.equal(waiting[0].role, "architect");
});

test("a wait without a reason is dropped and counted, never given one", () => {
  // Case 6, first half.
  const { waiting, dropped } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100 }),
  ]);
  assert.deepEqual(waiting, []);
  assert.equal(dropped, 1);
});

test("a wait with a reason outside the vocabulary is dropped and counted", () => {
  // Case 6, second half. A reason the reader does not know must not be rendered
  // as if it did.
  const { waiting, dropped } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100, reason: "stuck" }),
  ]);
  assert.deepEqual(waiting, []);
  assert.equal(dropped, 1);
});

test("a wait without a job tag is dropped and counted", () => {
  const { waiting, dropped } = foldWaitingForJob([
    {
      id: "x",
      pubkey: "agent",
      kind: WAITING,
      created_at: 100,
      content: "",
      sig: "sig",
      tags: [
        ["p", "owner"],
        ["reason", "ladder_exhausted"],
      ],
    },
  ]);
  assert.deepEqual(waiting, []);
  assert.equal(dropped, 1);
});

test("a wait whose role did not travel is kept as its own row", () => {
  // Case 7: no role is not "borrow another job's role", and it does not merge
  // two jobs into one.
  const { waiting } = foldWaitingForJob([
    event({ kind: WAITING, job: "j1", at: 100, reason: "ladder_exhausted" }),
    event({
      kind: WAITING,
      job: "j2",
      at: 100,
      reason: "ladder_exhausted",
      role: "coder",
    }),
  ]);
  assert.deepEqual(
    waiting.map((entry) => [entry.jobId, entry.role]),
    [
      ["j1", null],
      ["j2", "coder"],
    ],
  );
});

test("a malformed event does not blank a readable wait", () => {
  const { waiting } = foldWaitingForJob([
    { kind: WAITING, job: "j1", created_at: Number.NaN, tags: [] },
    event({ kind: WAITING, job: "j1", at: 100, reason: "ladder_exhausted" }),
  ]);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].at, new Date(100 * 1000).toISOString());
});

async function portfolioFrom(events) {
  const source = createTowerBuzzSource(
    async () => events,
    async () => "owner",
  );
  const lines = await source.getPortfolio();
  return new Map(lines.map((line) => [line.project.id, line]));
}

test("getPortfolio attaches the wait to its job's line", async () => {
  const byId = await portfolioFrom([
    event({ kind: LIFECYCLE, job: "active", at: 900, role: "coder" }),
    event({
      kind: WAITING,
      job: "active",
      at: 1000,
      reason: "ladder_exhausted",
      role: "coder",
    }),
  ]);
  assert.equal(byId.get("active").waiting.reason, "ladder_exhausted");
});

test("getPortfolio does not attach a wait a later movement beat", async () => {
  const byId = await portfolioFrom([
    event({
      kind: WAITING,
      job: "active",
      at: 900,
      reason: "ladder_exhausted",
    }),
    event({ kind: LIFECYCLE, job: "active", at: 1000, role: "coder" }),
  ]);
  assert.equal(byId.get("active").waiting, null);
});

test("getPortfolio reports an orphan wait as a line instead of losing it", async () => {
  // Case 5 reaching the surface: the wait has no lifecycle event in the window,
  // so it must become a line of its own rather than disappear.
  const byId = await portfolioFrom([
    event({
      kind: WAITING,
      job: "orphan",
      at: 1000,
      reason: "capability_denied",
      role: "architect",
    }),
  ]);
  const orphan = byId.get("orphan");
  assert.ok(orphan, "an orphan wait must be reported, not dropped");
  assert.equal(orphan.work, null);
  assert.equal(orphan.waiting.reason, "capability_denied");
  assert.equal(orphan.project.name, "architect");
  // No lifecycle event was observed, so the blocked cell must not claim one.
  assert.equal(orphan.blocked.basis, null);
});
