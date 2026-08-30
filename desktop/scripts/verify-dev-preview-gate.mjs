/**
 * Smoke tool: evaluate the real dev-preview gate against the real events the
 * desktop client has cached, and report PASS/FAIL per message.
 *
 * Written after a manual verification round was spent on a diagnosis that
 * reasoning from code made look certain and that was wrong. Reading one actual
 * event settled in a minute what code-reading could not. Reach for this before
 * theorising about why a card does or does not render.
 *
 * Usage (from `desktop/`):
 *
 *   node --import ./test-loader.mjs --experimental-strip-types \
 *     scripts/verify-dev-preview-gate.mjs <agent-pubkey-hex> [cache.db]
 *
 * The cache defaults to the packaged app's channel-head store. `sqlite3` must
 * be on PATH. Reads only; it never writes to the cache or the network.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import { parseDevPreviewAnnouncements } from "../src/shared/lib/devPreviewLink.ts";
import { isTrustedAgentAuthor } from "../src/features/messages/ui/trustedAgentAuthor.ts";

const [agentPubkey, cacheArg] = process.argv.slice(2);
if (!agentPubkey) {
  console.error(
    "usage: verify-dev-preview-gate.mjs <agent-pubkey-hex> [cache.db]",
  );
  process.exit(2);
}

const cache =
  cacheArg ??
  path.join(
    homedir(),
    "Library/Application Support/xyz.block.buzz.app/channel-head-cache.db",
  );

const rows = execFileSync(
  "sqlite3",
  [cache, "select events_json from channel_head;"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const isKnownAgentPubkey = (pubkey) => pubkey === agentPubkey;
const seen = new Set();
let checked = 0;
let passing = 0;

for (const line of rows.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[")) continue;
  let events;
  try {
    events = JSON.parse(trimmed);
  } catch {
    continue;
  }

  for (const event of events) {
    const content = event.content ?? "";
    if (!content.includes("[preview]")) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    checked += 1;

    // Mirror what the client does: without an `actor` tag the author is the
    // signer; with one, the author is what the tag claims. The client only
    // honours that tag on a verified relay signature — see shared/lib/authors.ts.
    const actor = (event.tags ?? []).find((tag) => tag[0] === "actor");
    const signerPubkey = event.pubkey;
    const pubkey = actor ? actor[1] : event.pubkey;

    const author = isTrustedAgentAuthor(
      { pubkey, signerPubkey },
      isKnownAgentPubkey,
      { acceptRelayAttribution: true },
    );
    const targets = parseDevPreviewAnnouncements(content);
    const renders = Boolean(author) && targets.length > 0;
    if (renders) passing += 1;

    console.log(
      [
        renders ? "PASS" : "FAIL",
        `gate=${author ? "ok" : "refused"}`,
        `detector=${targets.length ? `${targets.length} target(s)` : "no match"}`,
        JSON.stringify(content.slice(0, 60)),
      ].join("  "),
    );
  }
}

console.log(
  `\n${passing}/${checked} cached [preview] messages would render a card.`,
);
if (checked === 0) {
  console.log(
    "No cached [preview] message found. Wrong cache path, or the channel was never opened in this build?",
  );
}
