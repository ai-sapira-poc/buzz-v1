import assert from "node:assert/strict";
import test from "node:test";

import { TowerSourceError } from "../../features/tower/domain/TowerSource.ts";
import {
  buildJobEventFilter,
  createTowerBuzzSource,
} from "./towerBuzzSource.ts";

const OWNER = "owner-pubkey-hex";

function jobEvent({ kind, job, role = "builder", at, content = "" }) {
  return {
    id: `${job}-${kind}-${at}`,
    pubkey: "agent",
    kind,
    created_at: at,
    content,
    sig: "sig",
    tags: [
      ["p", OWNER],
      ["h", "channel-uuid"],
      ["job", job],
      ...(role === null ? [] : [["role", role]]),
    ],
  };
}

function sourceOver(events) {
  return createTowerBuzzSource(
    async () => events,
    async () => OWNER,
  );
}

test("every event of one job folds into one line carrying the newest state", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43001, job: "j1", at: 100, content: "Asked for a fix" }),
    jobEvent({ kind: 43002, job: "j1", at: 110 }),
    jobEvent({ kind: 43003, job: "j1", at: 120, content: "Halfway" }),
    jobEvent({ kind: 43004, job: "j1", at: 130, content: "Shipped the fix" }),
  ]).getPortfolio();

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    project: { id: "j1", name: "builder" },
    recency: { lastSpanAt: new Date(130 * 1000).toISOString() },
    blocked: { count: 0, basis: "observed" },
    cost: null,
    work: { state: "done", summary: "Shipped the fix" },
  });
});

test("out-of-order events still resolve to the newest state", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43004, job: "j1", at: 130 }),
    jobEvent({ kind: 43001, job: "j1", at: 100 }),
  ]).getPortfolio();
  assert.equal(lines[0].work.state, "done");
});

test("a job with only a request shows as requested, not as running or idle", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43001, job: "j1", at: 100 }),
  ]).getPortfolio();
  assert.equal(lines[0].work.state, "requested");
  assert.deepEqual(lines[0].blocked, { count: 0, basis: "observed" });
});

test("an error event shows as failed and is counted as needing attention", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43002, job: "j1", at: 100 }),
    jobEvent({ kind: 43006, job: "j1", at: 140, content: "Could not build" }),
  ]).getPortfolio();
  assert.equal(lines[0].work.state, "failed");
  assert.deepEqual(lines[0].blocked, { count: 1, basis: "observed" });
});

test("a cancelled job is not reported as blocked", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43005, job: "j1", at: 100 }),
  ]).getPortfolio();
  assert.equal(lines[0].work.state, "cancelled");
  assert.equal(lines[0].blocked.count, 0);
});

test("distinct job tags stay distinct lines", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43002, job: "j1", at: 100, role: "builder" }),
    jobEvent({ kind: 43006, job: "j2", at: 101, role: "reviewer" }),
  ]).getPortfolio();
  assert.deepEqual(
    lines.map((line) => [line.project.id, line.project.name, line.work.state]),
    [
      ["j1", "builder", "running"],
      ["j2", "reviewer", "failed"],
    ],
  );
});

test("cost is absent, never a measured zero", async () => {
  const lines = await sourceOver([
    jobEvent({ kind: 43004, job: "j1", at: 100 }),
  ]).getPortfolio();
  assert.equal(lines[0].cost, null);
});

test("an owner with no job events is a successful empty read", async () => {
  assert.deepEqual(await sourceOver([]).getPortfolio(), []);
});

test("a failed read rejects with a citable code instead of an empty list", async () => {
  const source = createTowerBuzzSource(
    async () => {
      throw new Error("relay unreachable");
    },
    async () => OWNER,
  );
  const settled = await source.getPortfolio().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  assert.equal(settled.value, undefined, "a dead source must not resolve");
  assert.ok(settled.error instanceof TowerSourceError);
  assert.equal(settled.error.code, "adapter_unavailable");
});

test("a missing owner identity is a failed read, not an owner with no work", async () => {
  const source = createTowerBuzzSource(
    async () => [],
    async () => "",
  );
  await assert.rejects(
    () => source.getPortfolio(),
    (error) => error instanceof TowerSourceError,
  );
});

test("the relay filter names its kinds explicitly and scopes to the owner", async () => {
  // Omitting `kinds` is refused by the relay's p-gate (403); the scoping tag is
  // what makes this the owner's portfolio rather than the whole relay's.
  let seenOwner = null;
  const source = createTowerBuzzSource(
    async (owner) => {
      seenOwner = owner;
      return [];
    },
    async () => OWNER,
  );
  await source.getPortfolio();
  assert.equal(seenOwner, OWNER);

  // Bound to the filter the production read sends, not to a test-only copy.
  const filter = buildJobEventFilter(OWNER);
  assert.deepEqual(filter.kinds, [43001, 43002, 43003, 43004, 43005, 43006]);
  assert.deepEqual(filter["#p"], [OWNER]);
  assert.ok(filter.limit > 0, "the read must be bounded");
});
