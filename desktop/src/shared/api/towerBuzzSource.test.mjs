import assert from "node:assert/strict";
import test from "node:test";

import { TowerSourceError } from "../../features/tower/domain/TowerSource.ts";
import { createTowerBuzzSource } from "./towerBuzzSource.ts";

function project(overrides = {}) {
  return {
    id: "project-a",
    name: "Project A",
    dtag: "project-a",
    description: "",
    owner: "owner",
    createdAt: 1_700_000_000,
    projectChannelId: null,
    relatedChannelIds: [],
    status: "active",
    projectAddress: "30621:owner:project-a",
    primaryRepositoryAddress: null,
    repositoryAddresses: [],
    repositories: [],
    legacy: false,
    ...overrides,
  };
}

test("the adapter maps each project to a line and reports what it cannot source", async () => {
  const source = createTowerBuzzSource(async () => [
    project(),
    project({ id: "b", name: "Project B" }),
  ]);
  const lines = await source.getPortfolio();
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    project: { id: "project-a", name: "Project A" },
    recency: { lastSpanAt: null },
    blocked: { count: 0, basis: null },
    cost: null,
  });
  assert.deepEqual(lines[1].project, { id: "b", name: "Project B" });
});

test("an empty project collection is a successful empty read", async () => {
  const source = createTowerBuzzSource(async () => []);
  assert.deepEqual(await source.getPortfolio(), []);
});

test("a failed read rejects with a citable code instead of an empty list", async () => {
  const source = createTowerBuzzSource(async () => {
    throw new Error("relay unreachable");
  });
  await assert.rejects(
    () => source.getPortfolio(),
    (error) => {
      assert.ok(error instanceof TowerSourceError);
      assert.equal(error.code, "adapter_unavailable");
      return true;
    },
  );
});
