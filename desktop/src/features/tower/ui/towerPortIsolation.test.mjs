import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Portability guard: the UI must not know Buzz or Nostr. Moving to another
 * OTel-speaking host means writing a new adapter, not touching a screen. If
 * this fails, the boundary has eroded — fix the import, do not relax the test.
 *
 * The panel is a second `ui/` behind the same port, so it is scanned here too:
 * a surface that reads the workforce through `TowerSource` must not learn a kind
 * number any more than the Tower rows may. The numeric pattern is deliberate —
 * a raw `43008` in a `.tsx` is the same leak as `KIND_JOB_WAITING`, and the
 * kind-name pattern alone would miss it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const UI_DIRECTORIES = [here, path.resolve(here, "../../panel/ui")];

const FORBIDDEN = [
  {
    pattern: /from\s+"@\/shared\/api\/(?:relay|nostr)/,
    label: "imports a relay/nostr API module",
  },
  { pattern: /\bnostr\b/i, label: "names Nostr" },
  { pattern: /\bKIND_[A-Z_]+\b/, label: "names a Nostr kind constant" },
  {
    pattern: /\b43\d{3}\b/,
    label: "names a raw agent-job kind number",
  },
];

test("the Tower and panel UI stay behind the TowerSource port", () => {
  let scanned = 0;
  for (const directory of UI_DIRECTORIES) {
    const files = fs
      .readdirSync(directory)
      .filter((file) => /\.(ts|tsx)$/.test(file));
    assert.ok(files.length > 0, `expected UI files to scan in ${directory}`);

    for (const file of files) {
      const content = fs.readFileSync(path.join(directory, file), "utf8");
      for (const { pattern, label } of FORBIDDEN) {
        assert.doesNotMatch(content, pattern, `${file}: ${label}`);
      }
      scanned += 1;
    }
  }
  assert.ok(scanned > 0, "expected at least one UI file across both surfaces");
});
