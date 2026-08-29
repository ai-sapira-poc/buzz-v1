import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  closeArtifact,
  getArtifactPanelSnapshotForTests,
  openArtifact,
  resetArtifactPanelForTests,
  setArtifactTab,
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
