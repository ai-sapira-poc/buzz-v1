import assert from "node:assert/strict";
import test from "node:test";

import { formatRecency, formatTokens } from "./portfolioFormat.ts";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

test("formatRecency returns null for an unreadable timestamp — never 'just now'", () => {
  assert.equal(formatRecency(null, NOW), null);
  assert.equal(formatRecency("not-a-date", NOW), null);
});

test("formatRecency buckets by minute, hour and day", () => {
  assert.equal(formatRecency("2026-09-15T11:59:30.000Z", NOW), "just now");
  assert.equal(formatRecency("2026-09-15T11:30:00.000Z", NOW), "30 min ago");
  assert.equal(formatRecency("2026-09-15T09:00:00.000Z", NOW), "3 h ago");
  assert.equal(formatRecency("2026-09-13T12:00:00.000Z", NOW), "2 d ago");
});

test("formatTokens thousands-separates the count", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(1234567), "1,234,567");
});
