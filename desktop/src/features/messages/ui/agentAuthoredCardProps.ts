import type { TimelineMessage } from "@/features/messages/types";
import { getConfigNudgeAuthorPubkey } from "./configNudgeAuthPubkey";
import { getDevPreviewAuthorPubkey } from "./devPreviewAuthPubkey";

/**
 * The Markdown props that gate agent-authored cards, resolved together.
 *
 * Both answer the same question — is this message trustworthy as coming from a
 * known agent? — and both resolve it through `isTrustedAgentAuthor`. Bundling
 * them keeps the two call sites (timeline row and inbox row) from drifting
 * apart, and keeps those files from growing a stanza per card type:
 * `MessageRow.tsx` sits at the file-size ceiling.
 */
export function agentAuthoredCardProps(
  message: Pick<TimelineMessage, "kind" | "pubkey" | "signerPubkey">,
  isKnownAgentPubkey: (pubkey: string) => boolean,
) {
  return {
    configNudgeAuthorPubkey: getConfigNudgeAuthorPubkey(
      message,
      isKnownAgentPubkey,
    ),
    devPreviewAuthorPubkey: getDevPreviewAuthorPubkey(
      message,
      isKnownAgentPubkey,
    ),
  };
}
