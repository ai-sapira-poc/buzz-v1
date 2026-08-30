import assert from "node:assert/strict";
import { test } from "node:test";

import { getDevPreviewAuthorPubkey } from "./devPreviewAuthPubkey.ts";

const AGENT = "a".repeat(64);
const HUMAN = "b".repeat(64);
const isAgent = (pubkey) => pubkey === AGENT;

test("enables the callout for a known agent signer", () => {
  assert.equal(
    getDevPreviewAuthorPubkey({ pubkey: AGENT, signerPubkey: AGENT }, isAgent),
    AGENT,
  );
});

test("a human author is ignored", () => {
  assert.equal(
    getDevPreviewAuthorPubkey({ pubkey: HUMAN, signerPubkey: HUMAN }, isAgent),
    undefined,
  );
});

test("an unsigned message is ignored", () => {
  assert.equal(getDevPreviewAuthorPubkey({}, isAgent), undefined);
  assert.equal(
    getDevPreviewAuthorPubkey({ signerPubkey: "" }, isAgent),
    undefined,
  );
});

test("accepts an agent the relay attributed", () => {
  // Production's shape: a relay-side agent does not sign — the relay does, and
  // `resolveEventAuthorPubkey` only produces this divergence after verifying
  // the relay's signature. Gating on the signer alone is what made the callout
  // invisible in the first production build.
  const RELAY = "r".repeat(64);
  assert.equal(
    getDevPreviewAuthorPubkey({ pubkey: AGENT, signerPubkey: RELAY }, isAgent),
    AGENT,
  );
});

test("a diverging claim whose author is not an agent is still refused", () => {
  const RELAY = "r".repeat(64);
  assert.equal(
    getDevPreviewAuthorPubkey({ pubkey: HUMAN, signerPubkey: RELAY }, isAgent),
    undefined,
  );
});
