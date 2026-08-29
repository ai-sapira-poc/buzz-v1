import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// R4 of docs/plan-artifact-preview.md §4.5 — the app-level CSP is the guard
// that keeps artifact scripts confined to the artifact:// document. Milestone
// A2 is allowed to add exactly one directive to it. This test fails loudly if
// anyone widens script-src to make an artifact "work", which is the failure
// this whole design exists to prevent.

const CSP = JSON.parse(
  readFileSync(new URL("../../../src-tauri/tauri.conf.json", import.meta.url)),
).app.security.csp;

const directives = new Map(
  CSP.split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values.join(" ")];
    }),
);

test("script-src is byte-identical to the pre-A2 baseline", () => {
  assert.equal(
    directives.get("script-src"),
    "'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@mediapipe/",
  );
});

test("script-src grants no inline or eval execution to the app document", () => {
  const scriptSrc = directives.get("script-src") ?? "";
  assert.equal(scriptSrc.includes("'unsafe-inline'"), false);
  assert.equal(scriptSrc.includes("'unsafe-eval'"), false);
});

test("frame-src is scoped to self and the artifact scheme only", () => {
  // A2's single addition. Loopback origins arrive with Phase B and must be
  // added deliberately, not inherited from a wildcard.
  assert.equal(directives.get("frame-src"), "'self' artifact:");
});

test("default-src is unchanged", () => {
  assert.equal(directives.get("default-src"), "'self'");
});

test("A2 added exactly one directive", () => {
  const expected = [
    "default-src",
    "base-uri",
    "form-action",
    "frame-ancestors",
    "object-src",
    "script-src",
    "style-src",
    "font-src",
    "connect-src",
    "img-src",
    "media-src",
    "worker-src",
    "frame-src",
  ];
  assert.deepEqual([...directives.keys()], expected);
});
