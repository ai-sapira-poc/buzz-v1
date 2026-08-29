import { DevPreviewCallout } from "@/features/artifacts/ui/DevPreviewCallout";
import { LinkPreviewList } from "@/shared/ui/link-preview-list";
import { LinkPreviewImageLightbox } from "@/shared/ui/markdown";
import type { ResolvedLinkPreview } from "@/shared/lib/useResolvedLinkPreviews";

/**
 * Link-preview cards rendered under a message body.
 *
 * Extracted verbatim from `markdown.tsx` so that file stops growing: it sits one
 * line under the 1000-line-per-file ratchet's recorded baseline, and every
 * addition below the prose has to come out of somewhere. Behaviour is
 * unchanged — same component, same props, same `key`.
 */
export function MessageLinkPreviews({
  content,
  devPreviewAuthorPubkey,
  interactive,
  messageId,
  onRemoveForEveryone,
  previews,
}: {
  content: string;
  /** Set only for agent-signed messages; gates the dev-server callout. */
  devPreviewAuthorPubkey?: string;
  interactive: boolean;
  messageId?: string;
  onRemoveForEveryone?: () => Promise<void>;
  previews: ResolvedLinkPreview[];
}) {
  return (
    <>
      <LinkPreviewList
        ImageLightbox={LinkPreviewImageLightbox}
        key={messageId}
        onRemoveForEveryone={onRemoveForEveryone}
        previews={previews}
      />
      <DevPreviewCallout
        authorPubkey={devPreviewAuthorPubkey}
        content={content}
        interactive={interactive}
      />
    </>
  );
}
