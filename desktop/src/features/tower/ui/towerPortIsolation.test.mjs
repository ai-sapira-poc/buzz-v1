import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Portability guard: the UI must not know Buzz or Nostr. Moving to another
 * OTel-speaking host means writing a new adapter, not touching a screen. If
 * this fails, the boundary has eroded — fix the import, do not relax the test.
 */
const uiDirectory = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  {
    pattern: /from\s+"@\/shared\/api\/(?:relay|nostr)/,
    label: "imports a relay/nostr API module",
  },
  { pattern: /\bnostr\b/i, label: "names Nostr" },
  { pattern: /\bKIND_[A-Z_]+\b/, label: "names a Nostr kind constant" },
];

test("the Tower UI stays behind the TowerSource port", () => {
  const files = fs
    .readdirSync(uiDirectory)
    .filter((file) => /\.(ts|tsx)$/.test(file));
  assert.ok(files.length > 0, "expected Tower UI files to scan");

  for (const file of files) {
    const content = fs.readFileSync(path.join(uiDirectory, file), "utf8");
    for (const { pattern, label } of FORBIDDEN) {
      assert.doesNotMatch(content, pattern, `${file}: ${label}`);
    }
  }
});
