import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatBuildStamp,
  formatBuildTooltip,
  formatBuiltAt,
} from "./buildIdentity.ts";

const AT = 1756558976; // a fixed instant; rendered in local time

const base = {
  version: "0.5.20",
  gitSha: "91798ba8c1d2",
  gitDirty: false,
  builtAt: AT,
  profile: "release",
  isDev: false,
};

test("formatBuiltAt: renders a readable local timestamp", () => {
  assert.match(formatBuiltAt(AT), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("formatBuiltAt: an unknown stamp renders empty, never 1970", () => {
  assert.equal(formatBuiltAt(0), "");
  assert.equal(formatBuiltAt(Number.NaN), "");
  assert.equal(formatBuiltAt(-1), "");
});

test("stamp: version, commit and time", () => {
  const stamp = formatBuildStamp(base);
  assert.ok(stamp.startsWith("v0.5.20 · 91798ba8c1d2 · "));
});

test("stamp: a dirty tree is marked, because the commit alone would mislead", () => {
  assert.ok(
    formatBuildStamp({ ...base, gitDirty: true }).includes("91798ba8c1d2+"),
  );
});

test("stamp: an unknown commit is omitted rather than shown as 'unknown'", () => {
  const stamp = formatBuildStamp({ ...base, gitSha: "unknown" });
  assert.equal(stamp.includes("unknown"), false);
  assert.ok(stamp.startsWith("v0.5.20"));
});

test("stamp: no info yet renders nothing", () => {
  assert.equal(formatBuildStamp(null), "");
});

test("tooltip: names the build and its commit", () => {
  const tip = formatBuildTooltip(base);
  assert.ok(tip.startsWith("Buzz 0.5.20\n"));
  assert.ok(tip.includes("commit 91798ba8c1d2"));
  assert.ok(tip.includes("compiled "));
});

test("tooltip: a dev build says so", () => {
  assert.ok(
    formatBuildTooltip({ ...base, isDev: true }).startsWith(
      "Buzz 0.5.20 (dev)",
    ),
  );
});

test("tooltip: uncommitted changes are spelled out, not just a plus", () => {
  assert.ok(
    formatBuildTooltip({ ...base, gitDirty: true }).includes(
      "uncommitted changes",
    ),
  );
});

test("tooltip: says compiled, not built, and explains the packaging gap", () => {
  // The .app's file date is minutes later than the compile stamp. Calling both
  // "built" made that look like a discrepancy during manual verification.
  const tip = formatBuildTooltip(base);
  assert.equal(tip.includes("built "), false);
  assert.ok(tip.includes("compiled "));
  assert.ok(tip.includes("packaged a few minutes later"));
});
