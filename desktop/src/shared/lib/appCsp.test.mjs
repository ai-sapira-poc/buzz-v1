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

test("frame-src is scoped to self, the artifact scheme, and loopback", () => {
  // A2 added `artifact:`; Phase B added the two loopback origins and nothing
  // else. Deliberate entries, never a bare `http:` wildcard.
  assert.equal(
    directives.get("frame-src"),
    "'self' artifact: http://localhost:* http://127.0.0.1:*",
  );
});

test("frame-src admits no non-loopback network origin", () => {
  const frameSrc = directives.get("frame-src") ?? "";
  for (const forbidden of ["http:", "https:", "*", "data:", "blob:"]) {
    assert.equal(
      frameSrc.split(/\s+/).includes(forbidden),
      false,
      `frame-src must not carry the bare token ${forbidden}`,
    );
  }
  for (const host of frameSrc
    .split(/\s+/)
    .filter((v) => v.startsWith("http"))) {
    assert.ok(
      host === "http://localhost:*" || host === "http://127.0.0.1:*",
      `unexpected frame-src origin: ${host}`,
    );
  }
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
