import { MonitorPlay } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { parseDevPreviewAnnouncements } from "@/shared/lib/devPreviewLink";
import { openDevPreview } from "../artifactPanelStore";

/**
 * Compact card offering to open a dev server an agent announced.
 *
 * Never loads anything on its own: the URL is shown as plain text and nothing
 * is fetched until the reader presses the button. That matters because the
 * sentinel is message text — the agent gate (`devPreviewAuthorPubkey`) decides
 * whether this renders at all, and the click decides whether anything loads.
 */
export function DevPreviewCallout({
  authorPubkey,
  content,
  interactive,
}: {
  /** Set only for messages signed by a known agent; undefined disables the card. */
  authorPubkey?: string;
  content: string;
  interactive: boolean;
}) {
  if (!interactive || !authorPubkey) return null;

  const targets = parseDevPreviewAnnouncements(content);
  if (targets.length === 0) return null;

  return (
    <div
      className="mt-2 flex flex-col gap-2"
      data-testid="dev-preview-callouts"
    >
      {targets.map((target) => (
        <div
          className="flex max-w-md items-center gap-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2"
          data-testid="dev-preview-callout"
          key={target.url}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
            <MonitorPlay className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              Dev server
            </span>
            {/* Shown verbatim so the reader sees exactly what they are loading. */}
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {target.url}
            </span>
          </span>
          <Button
            data-testid="dev-preview-open"
            onClick={() => openDevPreview({ kind: "devServer", ...target })}
            size="sm"
            variant="outline"
          >
            Open preview
          </Button>
        </div>
      ))}
    </div>
  );
}
