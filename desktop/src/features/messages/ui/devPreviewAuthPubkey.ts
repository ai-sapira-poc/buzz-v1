import type { TimelineMessage } from "@/features/messages/types";

/**
 * Returns the pubkey to use as `devPreviewAuthorPubkey` for a message, or
 * `undefined` when the dev-server callout must not render.
 *
 * The `[preview]` sentinel is plain message text, so anyone can type it. The
 * callout offers to load a local URL into the app, which is not something an
 * arbitrary author should be able to put in front of a reader — so the card is
 * enabled ONLY when `message.signerPubkey` passes `isKnownAgentPubkey`.
 *
 * Authenticating the raw event signer rather than `message.pubkey` matters:
 * the display author can be relay-delegated, and gating on it would let a
 * delegated post forge an agent-authored card. Same distinction, and same
 * reasoning, as `getConfigNudgeAuthorPubkey`.
 *
 * Unlike the config nudge this places no restriction on `kind`: agents announce
 * dev servers in ordinary channel messages.
 */
export function getDevPreviewAuthorPubkey(
  message: Pick<TimelineMessage, "signerPubkey">,
  isKnownAgentPubkey: (pubkey: string) => boolean,
): string | undefined {
  if (message.signerPubkey && isKnownAgentPubkey(message.signerPubkey)) {
    return message.signerPubkey;
  }
  return undefined;
}
