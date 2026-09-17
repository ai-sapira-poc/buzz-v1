import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import manifest from "@features-manifest";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(here, "ui");
const sidebarFile = path.join(
  here,
  "..",
  "sidebar",
  "ui",
  "AppSidebarPinnedHeader.tsx",
);

function readText(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => ({
      name,
      source: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
}

// Plan §5.1: the portability boundary is only real if a test fails when it
// erodes. The UI may not import the relay client, mention Nostr, or name a
// kind — all of that lives behind the TowerSource port in shared/api.
test("features/tower/ui does not import relay/nostr internals or name a kind", () => {
  const forbidden = [
    /@\/shared\/api\/relay/,
    /nostr/i,
    /\brelayClient\b/,
    /\bsubscribeLive\b/,
    /\bKIND_[A-Z_]+/,
  ];
  for (const { name, source } of readText(uiDir)) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${name} must stay transport-agnostic (matched ${pattern})`,
      );
    }
  }
});

// "Smallest slice that can be turned on": the feature must be declared in the
// manifest the FeatureGate reads, and the sidebar entry must be wrapped in it.
test("tower is declared as a desktop preview feature", () => {
  const tower = manifest.features.find((entry) => entry.id === "tower");
  assert.ok(tower, "preview-features.json must declare a `tower` feature");
  assert.ok(tower.platforms.includes("desktop"));
});

test('the sidebar tower entry is behind <FeatureGate feature="tower">', () => {
  const source = fs.readFileSync(sidebarFile, "utf8");
  const gate = source.match(
    /<FeatureGate feature="tower">([\s\S]*?)<\/FeatureGate>/,
  );
  assert.ok(gate, "AppSidebarPinnedHeader must wrap the tower entry in a gate");
  assert.match(gate[1], /onSelectTower/);
});
