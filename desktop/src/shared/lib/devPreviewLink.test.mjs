import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDevPreviewAnnouncements } from "./devPreviewLink.ts";

const urls = (content) =>
  parseDevPreviewAnnouncements(content).map((target) => target.url);

test("detects a bare localhost sentinel", () => {
  assert.deepEqual(urls("[preview] http://localhost:5173"), [
    "http://localhost:5173",
  ]);
});

test("detects 127.0.0.1", () => {
  assert.deepEqual(urls("[preview] http://127.0.0.1:8080"), [
    "http://127.0.0.1:8080",
  ]);
});

test("keeps an optional path", () => {
  assert.deepEqual(urls("[preview] http://localhost:3000/admin/users?tab=1"), [
    "http://localhost:3000/admin/users?tab=1",
  ]);
});

test("reports the port alongside the url", () => {
  assert.deepEqual(
    parseDevPreviewAnnouncements("[preview] http://localhost:4321/x"),
    [{ url: "http://localhost:4321/x", port: 4321 }],
  );
});

test("ignores an out-of-range or zero port", () => {
  assert.deepEqual(urls("[preview] http://localhost:0"), []);
  assert.deepEqual(urls("[preview] http://localhost:99999"), []);
});

test("ignores a missing port", () => {
  assert.deepEqual(urls("[preview] http://localhost"), []);
  assert.deepEqual(urls("[preview] http://localhost/path"), []);
});

test("ignores non-loopback hosts", () => {
  assert.deepEqual(urls("[preview] http://evil.com:3000"), []);
  assert.deepEqual(urls("[preview] http://localhost.evil.com:3000"), []);
  assert.deepEqual(urls("[preview] http://127.0.0.1.evil.com:3000"), []);
  assert.deepEqual(urls("[preview] http://192.168.1.10:3000"), []);
});

test("ignores https and other schemes", () => {
  assert.deepEqual(urls("[preview] https://localhost:3000"), []);
  assert.deepEqual(urls("[preview] file:///etc/passwd"), []);
});

test("ignores a loopback url with no sentinel", () => {
  assert.deepEqual(urls("check http://localhost:5173 when you can"), []);
});

test("finds several sentinels in one message", () => {
  assert.deepEqual(
    urls(
      "[preview] http://localhost:3000\nand [preview] http://127.0.0.1:4000/x",
    ),
    ["http://localhost:3000", "http://127.0.0.1:4000/x"],
  );
});

test("de-duplicates repeats of the same url", () => {
  assert.deepEqual(
    urls("[preview] http://localhost:3000 [preview] http://localhost:3000"),
    ["http://localhost:3000"],
  );
});

test("caps how many one message can announce", () => {
  const many = Array.from(
    { length: 9 },
    (_, i) => `[preview] http://localhost:${3000 + i}`,
  ).join("\n");
  assert.equal(parseDevPreviewAnnouncements(many).length, 4);
});

test("is case-insensitive on the sentinel", () => {
  assert.deepEqual(urls("[PREVIEW] http://localhost:3000"), [
    "http://localhost:3000",
  ]);
});

// --- Wrapped forms: what agents actually emit ---
//
// The first production build only matched a bare URL, so every real sentinel
// was invisible: they arrive as `[preview] <http://localhost:8000>`. These
// cases come from the events cached by the client during manual verification.

test("accepts a markdown autolink, the shape seen in production", () => {
  assert.deepEqual(urls("[preview] <http://localhost:8000>"), [
    "http://localhost:8000",
  ]);
});

test("the closing delimiter is not swallowed into the url", () => {
  const [target] = parseDevPreviewAnnouncements(
    "[preview] <http://localhost:8000/admin>",
  );
  assert.equal(target.url, "http://localhost:8000/admin");
  assert.equal(target.port, 8000);
});

test("accepts a full markdown link", () => {
  assert.deepEqual(urls("[preview] [localhost](http://localhost:5173/app)"), [
    "http://localhost:5173/app",
  ]);
});

test("accepts inline code and parentheses", () => {
  assert.deepEqual(urls("[preview] `http://localhost:3000`"), [
    "http://localhost:3000",
  ]);
  assert.deepEqual(urls("[preview] (http://localhost:3000)"), [
    "http://localhost:3000",
  ]);
});

test("a wrapped non-loopback host is still refused", () => {
  assert.deepEqual(urls("[preview] <http://evil.com:8000>"), []);
  assert.deepEqual(urls("[preview] <https://localhost:8000>"), []);
});
