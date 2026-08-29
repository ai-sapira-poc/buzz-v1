import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveArtifactKind } from "./artifactKind.ts";

test("resolveArtifactKind: returns null for a missing input", () => {
  assert.equal(resolveArtifactKind(undefined), null);
  assert.equal(resolveArtifactKind({}), null);
});

test("resolveArtifactKind: classifies .html and .htm by extension", () => {
  assert.equal(resolveArtifactKind({ filename: "report.html" }), "html");
  assert.equal(resolveArtifactKind({ filename: "legacy.htm" }), "html");
});

test("resolveArtifactKind: classifies text/html without a useful filename", () => {
  assert.equal(
    resolveArtifactKind({ filename: "blob", mime: "text/html" }),
    "html",
  );
});

test("resolveArtifactKind: tolerates MIME parameters and casing", () => {
  assert.equal(
    resolveArtifactKind({ filename: "x", mime: "Text/HTML; charset=utf-8" }),
    "html",
  );
});

test("resolveArtifactKind: classifies .svg by extension despite octet-stream MIME", () => {
  // This is the real shape on the wire: `infer` cannot sniff SVG, so buzz-media
  // stores it as application/octet-stream. A MIME-based check would miss it.
  assert.equal(
    resolveArtifactKind({
      filename: "diagram.svg",
      mime: "application/octet-stream",
    }),
    "svg",
  );
});

test("resolveArtifactKind: extension check is case-insensitive", () => {
  assert.equal(resolveArtifactKind({ filename: "REPORT.HTML" }), "html");
  assert.equal(resolveArtifactKind({ filename: "Diagram.SVG" }), "svg");
});

test("resolveArtifactKind: ignores query and fragment on a URL-derived name", () => {
  assert.equal(resolveArtifactKind({ filename: "page.html?v=2" }), "html");
  assert.equal(resolveArtifactKind({ filename: "chart.svg#frag" }), "svg");
});

test("resolveArtifactKind: uses only the trailing path segment", () => {
  assert.equal(resolveArtifactKind({ filename: "a/b/report.html" }), "html");
  assert.equal(resolveArtifactKind({ filename: "notes.html/decoy.pdf" }), null);
});

test("resolveArtifactKind: returns null for non-previewable attachments", () => {
  assert.equal(
    resolveArtifactKind({ filename: "notes.txt", mime: "text/plain" }),
    null,
  );
  assert.equal(
    resolveArtifactKind({ filename: "doc.pdf", mime: "application/pdf" }),
    null,
  );
  assert.equal(resolveArtifactKind({ filename: "bundle.zip" }), null);
  assert.equal(
    resolveArtifactKind({
      filename: "archive.bin",
      mime: "application/octet-stream",
    }),
    null,
  );
});

test("resolveArtifactKind: does not match a bare extension-like substring", () => {
  assert.equal(resolveArtifactKind({ filename: "html" }), null);
  assert.equal(resolveArtifactKind({ filename: "my.html.txt" }), null);
});

test("resolveArtifactKind: accepts image/svg+xml for completeness", () => {
  // Unreachable via resolveFileCard (image/* goes to the img renderer), but the
  // pure function should still be correct if called directly.
  assert.equal(
    resolveArtifactKind({ filename: "x", mime: "image/svg+xml" }),
    "svg",
  );
});
