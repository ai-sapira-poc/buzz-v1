import assert from "node:assert/strict";
import { test } from "node:test";

import { getDevPreviewAuthorPubkey } from "./devPreviewAuthPubkey.ts";

const AGENT = "a".repeat(64);
const HUMAN = "b".repeat(64);
const isAgent = (pubkey) => pubkey === AGENT;

test("enables the callout for a known agent signer", () => {
  assert.equal(
    getDevPreviewAuthorPubkey({ signerPubkey: AGENT }, isAgent),
    AGENT,
  );
});

test("a human author is ignored", () => {
  assert.equal(
    getDevPreviewAuthorPubkey({ signerPubkey: HUMAN }, isAgent),
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

test("gates on the signer, never on a delegated display author", () => {
  // A delegated post carries a human signer with an agent display author; the
  // card must not render for it.
  assert.equal(
    getDevPreviewAuthorPubkey({ pubkey: AGENT, signerPubkey: HUMAN }, isAgent),
    undefined,
  );
});
