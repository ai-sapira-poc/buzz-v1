import { Download, Eye, FileText } from "lucide-react";
import { toast } from "sonner";

import { invokeTauri } from "@/shared/api/tauri";
import type { ResolvedFileCard } from "@/shared/ui/markdownFileCard";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/shared/ui/attachment";
import { useMarkdownRuntime } from "./runtimeContext";

/** Human-readable byte size: "820 B", "12.4 KB", "3.1 MB". */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[i]}`;
}

/**
 * File card for a generic (non-image, non-video) attachment: icon, filename,
 * size, a download action, and — for previewable artifacts — a Preview action
 * that opens the file in the artifact panel.
 *
 * Downloads go through the native `download_file` Tauri command (HTTP inside
 * the app's tunnel + a save dialog), not a plain `<a download>` link. A bare
 * link navigates the webview to the blob URL, which escapes to the OS browser
 * and gets bounced to a corporate CDN interstitial ("browser not supported").
 * The native command mirrors the image-download path.
 *
 * The card is built from the `Attachment` primitives rather than a single
 * `<button>` so a second action can exist without nesting interactive elements:
 * `AttachmentTrigger` is the full-bleed download target at `z-10`, and
 * `AttachmentActions` sits above it at `z-20`. Clicking anywhere on the card
 * still downloads, exactly as before.
 */
export function FileCard({ card }: { card: ResolvedFileCard }) {
  // Read the panel handler from the markdown runtime rather than taking it as a
  // prop: read-only surfaces (the forum post renderer) simply omit it, and the
  // Preview action disappears with no branching at the call site.
  const { onOpenArtifact } = useMarkdownRuntime();
  const { filename, href, previewKind, size } = card;
  const sizeLabel = size != null ? formatFileSize(size) : "";
  const canPreview = Boolean(previewKind && onOpenArtifact);

  return (
    <Attachment
      className="my-1 inline-flex max-w-sm bg-muted/40 px-3 py-2 hover:bg-muted/70"
      data-testid="file-card"
      style={{ borderRadius: "1rem" }}
    >
      <AttachmentTrigger
        aria-label={`Download ${filename}`}
        onClick={() => {
          invokeTauri("download_file", { url: href, filename }).catch(
            (err: unknown) => {
              const msg =
                err instanceof Error ? err.message : "Download failed";
              toast.error(msg);
            },
          );
        }}
      />
      <AttachmentMedia className="h-9 w-9 rounded-lg">
        <FileText />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="font-medium">{filename}</AttachmentTitle>
        {sizeLabel ? (
          <AttachmentDescription>{sizeLabel}</AttachmentDescription>
        ) : null}
      </AttachmentContent>
      {canPreview ? (
        <AttachmentActions>
          <AttachmentAction
            aria-label={`Preview ${filename}`}
            data-testid="file-card-preview"
            onClick={() =>
              previewKind &&
              onOpenArtifact?.({
                kind: "attachment",
                url: href,
                filename,
                artifact: previewKind,
                size,
              })
            }
            title="Preview"
          >
            <Eye />
          </AttachmentAction>
        </AttachmentActions>
      ) : null}
      {/* Decorative: the whole card is the download target, so this icon must
          not intercept the pointer or it would create a dead zone over it. */}
      <Download
        aria-hidden="true"
        className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground"
      />
    </Attachment>
  );
}
