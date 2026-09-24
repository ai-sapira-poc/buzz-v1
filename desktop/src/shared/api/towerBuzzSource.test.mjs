import assert from "node:assert/strict";
import test from "node:test";

import { TowerSourceError } from "../../features/tower/domain/TowerSource.ts";
import {
  buildJobEventFilter,
  createTowerBuzzSource,
} from "./towerBuzzSource.ts";
import { JOB_KINDS } from "./towerJobFold.ts";

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
    // No 43008 in the read: the wait cell stays "sin señal", never 0.
    waiting: null,
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

test("a source that resolves no list is dead, not empty", async () => {
  // `?? []` used to turn a missing list into "no work yet" — the one meaning
  // the port reserves for a successful read.
  const portfolio = createTowerBuzzSource(
    async () => null,
    async () => OWNER,
  );
  const settled = await portfolio.getPortfolio().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  assert.equal(settled.value, undefined, "a missing list must not resolve");
  assert.ok(settled.error instanceof TowerSourceError);
  assert.equal(settled.error.code, "adapter_unavailable");

  const handover = createTowerBuzzSource(
    async () => [],
    async () => OWNER,
    async () => undefined,
  );
  await assert.rejects(
    () => handover.getHandovers(),
    (error) =>
      error instanceof TowerSourceError && error.code === "adapter_unavailable",
  );
});

test("the same window read twice folds to the first read, repeated id included", async () => {
  // §2-B(b2): D3 §1.2 fixes the dedup **per event id**, so re-reading one
  // window — the second read carrying an event that already travelled — must
  // fold to exactly what the first read did. No duplicated row, no lost row,
  // and no older repeat resurrecting a state the job has already left.
  // Deliberately *not* claimed here: the internal window overlap a `limit 500`
  // truncation could cause (D3 §3 says it cannot be known without live
  // telemetry), and any watermark or second origin (D3 §4).
  const window = [
    jobEvent({ kind: 43002, job: "j1", at: 100, role: "builder" }),
    jobEvent({
      kind: 43004,
      job: "j1",
      at: 130,
      role: "builder",
      content: "Shipped the fix",
    }),
    jobEvent({ kind: 43006, job: "j2", at: 101, role: "reviewer" }),
  ];
  const first = await sourceOver(window).getPortfolio();
  // The second read: the same window, with its first event seen again.
  const second = await sourceOver([...window, window[0]]).getPortfolio();

  assert.deepEqual(second, first, "the re-read must fold to the first read");
  // Absolute, because equality alone would also hold if *both* reads were
  // doubled: one row per job, not one per event.
  assert.equal(second.length, 2);
  assert.deepEqual(
    second.map((line) => line.project.id),
    ["j1", "j2"],
  );
  // The repeat is older than its job's newest event, so it must not win by
  // virtue of arriving last.
  assert.equal(second[0].work.state, "done");
  assert.equal(
    second[0].recency.lastSpanAt,
    new Date(130 * 1000).toISOString(),
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
  assert.deepEqual(
    filter.kinds,
    [...JOB_KINDS, 43008],
    "the wait projection rides the same read as the lifecycle kinds",
  );
  assert.ok(
    !JOB_KINDS.includes(43008),
    "43008 must not join the lifecycle state fold",
  );
  assert.deepEqual(filter["#p"], [OWNER]);
  assert.ok(filter.limit > 0, "the read must be bounded");
});
