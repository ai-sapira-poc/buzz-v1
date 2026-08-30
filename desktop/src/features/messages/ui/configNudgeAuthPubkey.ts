import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import type { TimelineMessage } from "@/features/messages/types";
import { isTrustedAgentAuthor } from "./trustedAgentAuthor";

/**
 * Returns the pubkey to use as `configNudgeAuthorPubkey` for a given message,
 * or `undefined` when the config-nudge card path should be disabled.
 *
 * The card is enabled ONLY when:
 *   1. `message.kind === KIND_STREAM_MESSAGE` — restricts to the setup-listener
 *      wire format.
 *   2. `isTrustedAgentAuthor` accepts the message — the gate shared with the
 *      dev-server preview callout — **without** relay attribution. This card
 *      drives configuration, so it requires the agent's own signature; a
 *      relay-signed `actor` claim is refused, as
 *      `relayDelegatesToAgent_relaySigner_returnsUndefined` pins. The caller's
 *      predicate combines the community-wide known-agent baseline
 *      (`useKnownAgentPubkeys`) with surface-local signals such as the signer
 *      profile's `isAgent` flag.
 *
 * Extracting this predicate as a pure helper lets tests exercise the exact
 * signer-vs-delegated-author distinction with a real `TimelineMessage` from
 * `formatTimelineMessages`, without a full React render harness.
 */
export function getConfigNudgeAuthorPubkey(
  message: Pick<TimelineMessage, "kind" | "pubkey" | "signerPubkey">,
  isKnownAgentPubkey: (pubkey: string) => boolean,
): string | undefined {
  if (message.kind !== KIND_STREAM_MESSAGE) return undefined;
  return isTrustedAgentAuthor(message, isKnownAgentPubkey);
}
