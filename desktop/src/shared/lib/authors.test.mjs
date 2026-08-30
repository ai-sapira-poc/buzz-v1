import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { resolveEventAuthorPubkey } from "./authors.ts";

const SIGNER_SECRET = new Uint8Array(32).fill(1);
const RELAY_SECRET = new Uint8Array(32).fill(2);
const SIGNER = getPublicKey(SIGNER_SECRET);
const RELAY = getPublicKey(RELAY_SECRET);
const ATTRIBUTED_USER = "33".repeat(32);
const CHANNEL_ID = "36411e44-0e2d-4cfe-bd6e-567eb169db9f";

function resolve({
  signer = "user",
  tags,
  relaySelfPubkey = RELAY,
  preferActorTag = true,
  tamperAfterSigning = false,
}) {
  const event = finalizeEvent(
    {
      kind: 9,
      created_at: 1_700_000_000,
      content: "hello",
      tags,
    },
    signer === "relay" ? RELAY_SECRET : SIGNER_SECRET,
  );
  const eventToResolve = tamperAfterSigning
    ? { ...JSON.parse(JSON.stringify(event)), content: "tampered" }
    : event;

  return resolveEventAuthorPubkey({
    event: eventToResolve,
    preferActorTag,
    relaySelfPubkey,
    requireChannelTagForPTags: true,
  });
}

test("user-signed actor tag cannot replace the visible author", () => {
  assert.equal(
    resolve({
      tags: [
        ["h", CHANNEL_ID],
        ["actor", ATTRIBUTED_USER],
      ],
    }),
    SIGNER,
  );
});

test("user-signed first p tag cannot replace the visible author", () => {
  assert.equal(
    resolve({
      tags: [
        ["p", ATTRIBUTED_USER],
        ["h", CHANNEL_ID],
      ],
    }),
    SIGNER,
  );
});

test("relay-signed actor tag resolves to the delegated author", () => {
  assert.equal(
    resolve({
      signer: "relay",
      tags: [
        ["h", CHANNEL_ID],
        ["actor", ATTRIBUTED_USER],
      ],
    }),
    ATTRIBUTED_USER,
  );
});

test("relay-signed author p tag resolves to the delegated author", () => {
  assert.equal(
    resolve({
      signer: "relay",
      preferActorTag: false,
      tags: [
        ["p", ATTRIBUTED_USER],
        ["h", CHANNEL_ID],
      ],
    }),
    ATTRIBUTED_USER,
  );
});

test("missing or malformed relay identity fails closed to the signer", () => {
  const tags = [
    ["h", CHANNEL_ID],
    ["actor", ATTRIBUTED_USER],
  ];

  assert.equal(resolve({ tags, relaySelfPubkey: null }), SIGNER);
  assert.equal(resolve({ tags, relaySelfPubkey: "not-a-pubkey" }), SIGNER);
});

test("malformed relay-signed attribution fails closed to the signer", () => {
  assert.equal(
    resolve({
      signer: "relay",
      tags: [
        ["h", CHANNEL_ID],
        ["actor", "not-a-pubkey"],
      ],
    }),
    RELAY,
  );
});

test("invalid relay event signature fails closed to the signer", () => {
  assert.equal(
    resolve({
      signer: "relay",
      tags: [
        ["h", CHANNEL_ID],
        ["actor", ATTRIBUTED_USER],
      ],
      tamperAfterSigning: true,
    }),
    RELAY,
  );
});

// --- Invariant relied on by features/messages/ui/trustedAgentAuthor.ts ---
//
// That gate treats `pubkey !== signerPubkey` as proof the relay attributed an
// event, and grants agent-card trust on that basis. The proof only holds while
// a forged attribution is incapable of producing divergence. These tests pin
// it from this side; `trustedAgentAuthor.test.mjs` pins the other. Break one
// and the pair should fail loudly rather than quietly widening the gate.

test("invariant: a forged actor tag on a self-signed event never diverges", () => {
  const resolved = resolve({
    signer: "user",
    tags: [
      ["h", CHANNEL_ID],
      ["actor", ATTRIBUTED_USER],
    ],
  });
  assert.equal(
    resolved,
    SIGNER,
    "an actor tag on an event the relay did not sign must resolve to its own signer",
  );
});

test("invariant: attribution is refused when relay identity is unknown", () => {
  const resolved = resolve({
    signer: "relay",
    relaySelfPubkey: null,
    tags: [
      ["h", CHANNEL_ID],
      ["actor", ATTRIBUTED_USER],
    ],
  });
  assert.equal(resolved, RELAY, "no NIP-11 identity means no attribution");
});

test("invariant: attribution is refused when the signature does not verify", () => {
  const resolved = resolve({
    signer: "relay",
    tamperAfterSigning: true,
    tags: [
      ["h", CHANNEL_ID],
      ["actor", ATTRIBUTED_USER],
    ],
  });
  assert.equal(
    resolved,
    RELAY,
    "a tampered relay event must not attribute authorship",
  );
});

test("invariant: only a verified relay signature produces divergence", () => {
  const resolved = resolve({
    signer: "relay",
    tags: [
      ["h", CHANNEL_ID],
      ["actor", ATTRIBUTED_USER],
    ],
  });
  assert.equal(resolved, ATTRIBUTED_USER);
  assert.notEqual(resolved, RELAY, "this is the one case that may diverge");
});
