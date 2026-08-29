import assert from "node:assert/strict";
import { test } from "node:test";

import { buildArtifactSrcDoc, sourceHasScript } from "./artifactDocument.ts";

test("buildArtifactSrcDoc: HTML passes through untouched", () => {
  const html = "<!doctype html><html><body><p>hi</p></body></html>";
  assert.equal(buildArtifactSrcDoc("html", html), html);
});

test("buildArtifactSrcDoc: SVG is wrapped in a host document", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
  const doc = buildArtifactSrcDoc("svg", svg);
  assert.ok(doc.startsWith("<!doctype html>"));
  assert.ok(
    doc.includes(svg),
    "the original markup must be preserved verbatim",
  );
});

test("buildArtifactSrcDoc: SVG wrapper sets no colours of its own", () => {
  const doc = buildArtifactSrcDoc("svg", "<svg/>");
  assert.equal(/color|background/i.test(doc), false);
});

test("sourceHasScript: detects a script element", () => {
  assert.equal(sourceHasScript("<body><script>x()</script></body>"), true);
  assert.equal(sourceHasScript('<script src="a.js"></script>'), true);
  assert.equal(sourceHasScript("<SCRIPT>x()</SCRIPT>"), true);
});

test("sourceHasScript: does not fire on prose mentioning the word", () => {
  assert.equal(sourceHasScript("<p>the script was long</p>"), false);
  assert.equal(sourceHasScript("<p>&lt;script&gt;</p>"), false);
});

test("sourceHasScript: false for script-free markup", () => {
  assert.equal(sourceHasScript("<svg><rect/></svg>"), false);
  assert.equal(sourceHasScript(""), false);
});
