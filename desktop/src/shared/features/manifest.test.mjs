import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../../preview-features.json", import.meta.url),
    "utf8",
  ),
);

test("thread-scoped ACP sessions is a default-off desktop experiment", () => {
  const feature = manifest.features.find(
    ({ id }) => id === "threadScopedAcpSessions",
  );

  assert.deepEqual(feature, {
    id: "threadScopedAcpSessions",
    name: "Thread Scoped ACP Sessions",
    description:
      "Give each channel thread isolated agent context. Applies when managed agents next start; DMs stay conversation-scoped.",
    platforms: ["desktop"],
  });
  assert.equal(feature.defaultEnabled, undefined);
});

test("surface-only experiments are on by default in this fork", () => {
  // This fork ships the preview surfaces enabled: Projects, Pulse, Workflows
  // and Forum are read-and-navigate UI, so defaulting them on costs nothing but
  // a visible tab and is how the control-plane work is actually used here.
  for (const id of ["projects", "pulse", "workflows", "forum"]) {
    const feature = manifest.features.find((entry) => entry.id === id);
    assert.ok(feature, `${id} missing from the manifest`);
    assert.equal(feature.defaultEnabled, true, `${id} should default on`);
    assert.deepEqual(feature.platforms, ["desktop"]);
  }
});

test("experiments that reach the Tauri backend stay default-off", () => {
  // These two are not just a tab: their UI toggle also calls
  // setThreadScopedAcpSessions / setAgentManagedProfiles so the backend learns
  // the new value. `defaultEnabled` fires no such call, so defaulting them on
  // would render the switch as enabled while the backend was never told —
  // manifest and runtime silently disagreeing. They must be turned on through
  // the Experimental settings panel, never here.
  for (const id of ["threadScopedAcpSessions", "agentManagedProfiles"]) {
    const feature = manifest.features.find((entry) => entry.id === id);
    assert.ok(feature, `${id} missing from the manifest`);
    assert.equal(
      feature.defaultEnabled,
      undefined,
      `${id} must stay default-off`,
    );
  }
});
