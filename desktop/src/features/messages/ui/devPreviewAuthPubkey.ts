import type { TimelineMessage } from "@/features/messages/types";
import { isTrustedAgentAuthor } from "./trustedAgentAuthor";

/**
 * Returns the pubkey to use as `devPreviewAuthorPubkey` for a message, or
 * `undefined` when the dev-server callout must not render.
 *
 * The `[preview]` sentinel is plain message text, so anyone can type it. The
 * callout offers to load a local URL into the app, which is not something an
 * arbitrary author should be able to put in front of a reader — so the card is
 * enabled ONLY when `message.signerPubkey` passes `isKnownAgentPubkey`.
 *
 * Trust is decided by `isTrustedAgentAuthor`, shared with the config-nudge
 * card. This caller opts into relay attribution, which the config nudge
 * deliberately refuses: the callout only ever offers a loopback URL the reader
 * must click, and refusing attribution makes it useless in production, where
 * relay-side agents do not sign their own events. Unlike the config nudge this places no restriction on
 * `kind`: agents announce dev servers in ordinary channel messages.
 */
export function getDevPreviewAuthorPubkey(
  message: Pick<TimelineMessage, "pubkey" | "signerPubkey">,
  isKnownAgentPubkey: (pubkey: string) => boolean,
): string | undefined {
  return isTrustedAgentAuthor(message, isKnownAgentPubkey, {
    acceptRelayAttribution: true,
  });
}
