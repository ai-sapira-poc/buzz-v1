import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHandoffEventFilter,
  foldHandoffEdges,
} from "./towerHandoffEdges.ts";

const OWNER = "owner-pubkey-hex";

/** A handoff edge, shaped exactly as the producer writes it. */
function handoffEvent({
  parent,
  child,
  role = "builder",
  at = 100,
  channel = "chan-1",
} = {}) {
  return {
    id: `${parent}-${child}-${at}`,
    pubkey: "agent",
    kind: 43007,
    created_at: at,
    content: "",
    sig: "sig",
    tags: [
      ["p", OWNER],
      ...(channel === null ? [] : [["h", channel]]),
      ["job", parent],
      ...(child === null ? [] : [["child", child]]),
      ...(role === null ? [] : [["role", role]]),
    ],
  };
}

function lifecycleEvent({ kind, job, at, role = "builder" }) {
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

test("one handoff event is one row, keyed by the parent→child edge", () => {
  const rows = foldHandoffEdges([handoffEvent({ parent: "p1", child: "c1" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "p1->c1");
  assert.equal(rows[0].sender.jobId, "p1");
  assert.equal(rows[0].child.jobId, "c1");
});

test("fan-out to two children is two rows, never one row per parent", () => {
  const rows = foldHandoffEdges([
    handoffEvent({ parent: "p1", child: "c1", at: 100 }),
    handoffEvent({ parent: "p1", child: "c2", at: 101 }),
  ]);
  assert.deepEqual(rows.map((row) => row.child.jobId).sort(), ["c1", "c2"]);
});

test("the sender is the emitter of the handoff, not the child's role", () => {
  const rows = foldHandoffEdges([
    handoffEvent({ parent: "p1", child: "c1", role: "architect" }),
  ]);
  assert.equal(rows[0].sender.name, "architect");
});

test("the parent's terminal outcome is joined from its own lifecycle event", () => {
  const rows = foldHandoffEdges([
    lifecycleEvent({ kind: 43004, job: "p1", at: 90 }),
    handoffEvent({ parent: "p1", child: "c1", at: 100 }),
  ]);
  assert.equal(rows[0].parentOutcome, "done");
});

test("a failed parent is distinguished from a finished one by outcome, not color", () => {
  const rows = foldHandoffEdges([
    lifecycleEvent({ kind: 43006, job: "p1", at: 90 }),
    lifecycleEvent({ kind: 43004, job: "p2", at: 91 }),
    handoffEvent({ parent: "p1", child: "c1", at: 100 }),
    handoffEvent({ parent: "p2", child: "c2", at: 101 }),
  ]);
  const byChild = Object.fromEntries(rows.map((r) => [r.child.jobId, r]));
  assert.equal(byChild.c1.parentOutcome, "failed");
  assert.equal(byChild.c2.parentOutcome, "done");
});

test("a cancelled parent is its own outcome, not folded into failed", () => {
  const rows = foldHandoffEdges([
    lifecycleEvent({ kind: 43005, job: "p1", at: 90 }),
    handoffEvent({ parent: "p1", child: "c1", at: 100 }),
  ]);
  assert.equal(rows[0].parentOutcome, "cancelled");
});

test("an unreadable parent end is `unknown`, never a fabricated outcome", () => {
  const rows = foldHandoffEdges([handoffEvent({ parent: "p1", child: "c1" })]);
  assert.equal(rows[0].parentOutcome, "unknown");
});

test("an edge with no child is dropped, not drawn as a half row", () => {
  // Removing the `childJobId === null` guard must fail this test: the section
  // would draw a handoff row with no receiver.
  assert.deepEqual(
    foldHandoffEdges([handoffEvent({ parent: "p1", child: null })]),
    [],
  );
});

test("an edge with no parent job is dropped", () => {
  const event = handoffEvent({ parent: "p1", child: "c1" });
  event.tags = event.tags.filter((tag) => tag[0] !== "job");
  assert.deepEqual(foldHandoffEdges([event]), []);
});

test("kinds outside the handoff and terminal sets are ignored", () => {
  assert.deepEqual(
    foldHandoffEdges([lifecycleEvent({ kind: 43002, job: "p1", at: 90 })]),
    [],
  );
});

test("malformed events degrade instead of crashing the fold", () => {
  const rows = foldHandoffEdges([
    null,
    { kind: 43007, tags: "not-an-array", created_at: 100 },
    { kind: 43007, tags: ["not-a-tag"], created_at: 100 },
  ]);
  assert.deepEqual(rows, []);
});

test("the thread carries the channel but not a thread id it was never given", () => {
  const [row] = foldHandoffEdges([handoffEvent({ parent: "p1", child: "c1" })]);
  assert.deepEqual(row.thread, { channel: "chan-1", eventId: null });
});

test("no channel is 'sin hilo', distinguishable from an unopenable thread", () => {
  const [row] = foldHandoffEdges([
    handoffEvent({ parent: "p1", child: "c1", channel: null }),
  ]);
  assert.equal(row.thread, null);
});

test("an unreadable instant is null, never 'now'", () => {
  const event = handoffEvent({ parent: "p1", child: "c1" });
  event.created_at = Number.NaN;
  const [row] = foldHandoffEdges([event]);
  assert.equal(row.transferredAt, null);
});

test("rows are newest first", () => {
  const rows = foldHandoffEdges([
    handoffEvent({ parent: "p1", child: "c1", at: 100 }),
    handoffEvent({ parent: "p2", child: "c2", at: 200 }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.child.jobId),
    ["c2", "c1"],
  );
});

test("the relay filter names its kinds explicitly and scopes to the owner", () => {
  // Omitting `kinds` is refused by the relay's p-gate (403). The lifecycle
  // kinds travel with the edge so the parent's end arrives in the same read.
  const filter = buildHandoffEventFilter(OWNER);
  assert.deepEqual(
    filter.kinds,
    [43001, 43002, 43003, 43004, 43005, 43006, 43007],
  );
  assert.deepEqual(filter["#p"], [OWNER]);
  assert.ok(filter.limit > 0, "the read must be bounded");
});
