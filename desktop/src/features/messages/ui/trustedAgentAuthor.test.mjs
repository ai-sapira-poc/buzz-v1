import assert from "node:assert/strict";
import { test } from "node:test";

import { isTrustedAgentAuthor } from "./trustedAgentAuthor.ts";

const AGENT = "a".repeat(64);
const RELAY = "r".repeat(64);
const HUMAN = "b".repeat(64);
const isAgent = (pubkey) => pubkey === AGENT;

// --- 1. The agent signed its own event (locally managed agent) ---

test("accepts an agent that signed its own event", () => {
  assert.equal(
    isTrustedAgentAuthor({ pubkey: AGENT, signerPubkey: AGENT }, isAgent),
    AGENT,
  );
});

// --- 2. The relay signed and attributed the agent (production shape) ---

const WITH_ATTRIBUTION = { acceptRelayAttribution: true };

test("accepts an agent the relay attributed, when the caller opts in", () => {
  // resolveEventAuthorPubkey only produces this divergence after verifying the
  // event is signed by the relay advertised in NIP-11.
  assert.equal(
    isTrustedAgentAuthor(
      { pubkey: AGENT, signerPubkey: RELAY },
      isAgent,
      WITH_ATTRIBUTION,
    ),
    AGENT,
  );
});

test("relay attribution is refused by default", () => {
  // The config-nudge card relies on this default: it drives configuration and
  // demands the agent's own signature.
  assert.equal(
    isTrustedAgentAuthor({ pubkey: AGENT, signerPubkey: RELAY }, isAgent),
    undefined,
  );
});

test("the attributed author is what gets returned, not the relay", () => {
  const attributed = isTrustedAgentAuthor(
    { pubkey: AGENT, signerPubkey: RELAY },
    isAgent,
    WITH_ATTRIBUTION,
  );
  assert.notEqual(attributed, RELAY);
});

// --- 3. Forged attribution: a claim that never went through the relay ---

test("rejects a non-diverging claim from a non-agent", () => {
  // A self-signed event carrying a forged `actor` tag resolves back to its own
  // signer, so pubkey === signerPubkey. This is the shape that reaches here,
  // and it must be refused. Pinned from the other side by authors.test.mjs.
  assert.equal(
    isTrustedAgentAuthor({ pubkey: HUMAN, signerPubkey: HUMAN }, isAgent),
    undefined,
  );
});

test("rejects a diverging claim whose author is not a known agent", () => {
  assert.equal(
    isTrustedAgentAuthor(
      { pubkey: HUMAN, signerPubkey: RELAY },
      isAgent,
      WITH_ATTRIBUTION,
    ),
    undefined,
  );
});

test("rejects when neither side is a known agent", () => {
  assert.equal(
    isTrustedAgentAuthor({ pubkey: RELAY, signerPubkey: RELAY }, isAgent),
    undefined,
  );
});

// --- Shape guards ---

test("rejects an unsigned message", () => {
  assert.equal(isTrustedAgentAuthor({ pubkey: AGENT }, isAgent), undefined);
  assert.equal(
    isTrustedAgentAuthor({ pubkey: AGENT, signerPubkey: "" }, isAgent),
    undefined,
  );
});

test("a missing display author falls back to the signer check", () => {
  assert.equal(isTrustedAgentAuthor({ signerPubkey: AGENT }, isAgent), AGENT);
  assert.equal(
    isTrustedAgentAuthor({ signerPubkey: RELAY }, isAgent),
    undefined,
  );
});
