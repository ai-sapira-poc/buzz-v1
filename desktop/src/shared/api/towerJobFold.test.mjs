import assert from "node:assert/strict";
import test from "node:test";

import { foldJobEventsToPortfolio } from "./towerJobFold.ts";

function event(overrides = {}) {
  return {
    id: "e1",
    pubkey: "agent",
    kind: 43002,
    created_at: 100,
    content: "",
    sig: "sig",
    tags: [
      ["p", "owner"],
      ["job", "j1"],
      ["role", "builder"],
    ],
    ...overrides,
  };
}

test("an event without a job tag is dropped, not guessed at or thrown on", () => {
  const lines = foldJobEventsToPortfolio([
    event({ tags: [["p", "owner"]] }),
    event({ id: "e2", tags: [["job", "j1"]] }),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].project.id, "j1");
});

test("a job whose events never name a role is still a line", () => {
  const lines = foldJobEventsToPortfolio([event({ tags: [["job", "j1"]] })]);
  assert.equal(lines[0].project.name, "Unnamed agent");
  assert.equal(lines[0].work.state, "running");
});

test("a role named on any event of the job is not erased by a later one", () => {
  const lines = foldJobEventsToPortfolio([
    event({ kind: 43001, created_at: 100 }),
    event({ id: "e2", kind: 43004, created_at: 110, tags: [["job", "j1"]] }),
  ]);
  assert.equal(lines[0].project.name, "builder");
  assert.equal(lines[0].work.state, "done");
});

test("kinds outside the job lifecycle are ignored", () => {
  assert.deepEqual(foldJobEventsToPortfolio([event({ kind: 40002 })]), []);
});

test("malformed events degrade instead of crashing the fold", () => {
  const lines = foldJobEventsToPortfolio([
    null,
    event({ tags: "not-an-array" }),
    event({ id: "e2", created_at: Number.NaN }),
    event({ id: "e3", content: 42 }),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].work.summary, null);
});

test("the state comes from the kind, never from the content", () => {
  const lines = foldJobEventsToPortfolio([
    event({ kind: 43002, content: "this failed catastrophically" }),
  ]);
  assert.equal(lines[0].work.state, "running");
  assert.equal(lines[0].blocked.count, 0);
});

test("a terminal event sharing a second with its acceptance still wins", () => {
  const lines = foldJobEventsToPortfolio([
    event({ kind: 43004, created_at: 100 }),
    event({ id: "e2", kind: 43002, created_at: 100 }),
  ]);
  assert.equal(lines[0].work.state, "done");
});
