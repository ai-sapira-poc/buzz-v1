import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  closeArtifact,
  getArtifactPanelSnapshotForTests,
  openArtifact,
  resetArtifactPanelForTests,
  setArtifactTab,
  trustArtifact,
} from "./artifactPanelStore.ts";

const HTML_TARGET = {
  kind: "attachment",
  url: "https://relay.example/media/aaa.html",
  filename: "report.html",
  artifact: "html",
};

const SVG_TARGET = {
  kind: "attachment",
  url: "https://relay.example/media/bbb.bin",
  filename: "diagram.svg",
  artifact: "svg",
};

beforeEach(() => {
  resetArtifactPanelForTests();
});

test("starts closed", () => {
  assert.deepEqual(getArtifactPanelSnapshotForTests(), {
    target: null,
    tab: "preview",
    trusted: false,
  });
});

test("openArtifact sets the target and defaults to the preview tab", () => {
  openArtifact(HTML_TARGET);
  const snap = getArtifactPanelSnapshotForTests();
  assert.equal(snap.target?.filename, "report.html");
  assert.equal(snap.tab, "preview");
});

test("re-opening the same artifact is a no-op and preserves the chosen tab", () => {
  openArtifact(HTML_TARGET);
  setArtifactTab("source");
  const before = getArtifactPanelSnapshotForTests();
  openArtifact({ ...HTML_TARGET });
  const after = getArtifactPanelSnapshotForTests();
  assert.equal(after.tab, "source");
  assert.equal(after, before, "snapshot identity must be stable for a no-op");
});

test("opening a different artifact replaces it and resets the tab", () => {
  openArtifact(HTML_TARGET);
  setArtifactTab("source");
  openArtifact(SVG_TARGET);
  const snap = getArtifactPanelSnapshotForTests();
  assert.equal(snap.target?.filename, "diagram.svg");
  assert.equal(snap.tab, "preview");
});

test("closeArtifact clears the target", () => {
  openArtifact(HTML_TARGET);
  closeArtifact();
  assert.equal(getArtifactPanelSnapshotForTests().target, null);
});

test("closing when already closed does not churn the snapshot", () => {
  const before = getArtifactPanelSnapshotForTests();
  closeArtifact();
  assert.equal(getArtifactPanelSnapshotForTests(), before);
});

test("setArtifactTab is a no-op when the tab is unchanged", () => {
  openArtifact(HTML_TARGET);
  const before = getArtifactPanelSnapshotForTests();
  setArtifactTab("preview");
  assert.equal(getArtifactPanelSnapshotForTests(), before);
});

// --- A2: the explicit opt-in gate before an artifact's scripts run ---

test("an artifact is untrusted when it opens", () => {
  openArtifact(HTML_TARGET);
  assert.equal(getArtifactPanelSnapshotForTests().trusted, false);
});

test("trustArtifact opts in", () => {
  openArtifact(HTML_TARGET);
  trustArtifact();
  assert.equal(getArtifactPanelSnapshotForTests().trusted, true);
});

test("trust does not carry to a different artifact", () => {
  openArtifact(HTML_TARGET);
  trustArtifact();
  openArtifact(SVG_TARGET);
  assert.equal(
    getArtifactPanelSnapshotForTests().trusted,
    false,
    "each artifact must earn its own opt-in",
  );
});

test("trust is discarded when the panel closes", () => {
  openArtifact(HTML_TARGET);
  trustArtifact();
  closeArtifact();
  openArtifact(HTML_TARGET);
  assert.equal(getArtifactPanelSnapshotForTests().trusted, false);
});

test("switching tabs does not revoke trust", () => {
  openArtifact(HTML_TARGET);
  trustArtifact();
  setArtifactTab("source");
  setArtifactTab("preview");
  assert.equal(getArtifactPanelSnapshotForTests().trusted, true);
});

test("trustArtifact does nothing with no artifact open", () => {
  trustArtifact();
  assert.equal(getArtifactPanelSnapshotForTests().trusted, false);
});
