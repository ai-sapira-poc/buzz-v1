import type { TimelineMessage } from "@/features/messages/types";

/**
 * The single trust gate for agent-authored cards.
 *
 * Returns the agent pubkey to attribute a card to, or `undefined` when no card
 * may render. Both the config-nudge card and the dev-server preview callout go
 * through here: a duplicated trust gate drifts, a shared one is audited once.
 *
 * # Two ways a message can legitimately come from an agent
 *
 * **Signed directly.** A locally managed agent signs its own events, so
 * `signerPubkey` is the agent and matches `pubkey`. Authenticating the signer
 * is the whole check.
 *
 * **Attributed by the relay.** A relay-side agent does not sign: the relay
 * signs and attaches an `actor` tag claiming the agent as author. Here
 * `pubkey` is the agent and `signerPubkey` is the relay. Gating on the signer
 * alone silently hides every card in this shape — which is exactly how the
 * Phase B callout shipped broken, since the mock's agent signs its own
 * messages and production's does not.
 *
 * # Why divergence is itself the proof of attribution
 *
 * `pubkey !== signerPubkey` is not a heuristic. `resolveEventAuthorPubkey`
 * (`shared/lib/authors.ts`) returns the signer unchanged unless **both** hold:
 * the event is signed by the relay advertised in NIP-11, and its signature
 * verifies. A forged `actor` tag on a self-signed event resolves back to its
 * own signer, so it can never produce divergence.
 *
 * That invariant is what this gate rests on, so it is pinned by test on both
 * sides: `shared/lib/authors.test.mjs` asserts a forged attribution never
 * diverges, and `trustedAgentAuthor.test.mjs` asserts this gate rejects a
 * non-diverging claim. **If you change the attribution rules in `authors.ts`,
 * re-read this file** — the two hold each other up.
 *
 * # Why relay attribution is opt-in per caller
 *
 * Accepting it is not free: it extends trust from "the agent signed this" to
 * "the relay says the agent authored this". The dev-server callout opts in,
 * because it only ever offers a loopback URL the reader must click, and
 * because refusing it makes the feature useless in production.
 *
 * The config-nudge card deliberately does not, and
 * `configNudgeAuthPubkey.test.mjs` pins that with a relay-signed `actor` event
 * asserting "relay delegation must not be treated as an agent signature". That
 * card drives configuration, so its author demanded the agent's own signature.
 * Sharing this helper must not quietly reverse that call — hence the flag
 * rather than one blanket rule.
 */
export function isTrustedAgentAuthor(
  message: Pick<TimelineMessage, "pubkey" | "signerPubkey">,
  isKnownAgentPubkey: (pubkey: string) => boolean,
  { acceptRelayAttribution = false }: { acceptRelayAttribution?: boolean } = {},
): string | undefined {
  const { pubkey, signerPubkey } = message;
  if (!signerPubkey) return undefined;

  // Signed directly by the agent.
  if (isKnownAgentPubkey(signerPubkey)) return signerPubkey;

  // Attributed by the relay: the divergence only exists because
  // `resolveEventAuthorPubkey` already verified the relay's signature.
  if (
    acceptRelayAttribution &&
    pubkey &&
    pubkey !== signerPubkey &&
    isKnownAgentPubkey(pubkey)
  ) {
    return pubkey;
  }

  return undefined;
}
