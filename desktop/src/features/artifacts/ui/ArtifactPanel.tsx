import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { sourceHasScript } from "../artifactDocument";
import {
  type ArtifactPanelTab,
  setArtifactTab,
  useArtifactPanel,
} from "../artifactPanelStore";
import {
  MAX_ARTIFACT_PREVIEW_BYTES,
  useArtifactSource,
} from "../useArtifactSource";
import { ArtifactFrame } from "./ArtifactFrame";
import { ArtifactSourceView } from "./ArtifactSourceView";

function formatMib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PanelNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/**
 * Body of the artifact preview panel.
 *
 * Renders **only** the body: the panel shell, header, close button and resize
 * handle come from `IdleAuxiliaryPanel` via the `idleAuxiliaryPanel` slot on
 * `ChannelPane`. Wrapping `AuxiliaryPanel` again here would double the chrome.
 */
export function ArtifactPanel() {
  const { target, tab } = useArtifactPanel();
  const query = useArtifactSource(target);

  if (!target) return null;

  if (query.isPending) {
    return (
      <div className="space-y-2 pt-2" data-testid="artifact-panel-loading">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : "Could not load this file.";
    return (
      <PanelNotice>
        <span data-testid="artifact-panel-error">{message}</span>
      </PanelNotice>
    );
  }

  if (query.data.status === "too-large") {
    return (
      <PanelNotice>
        <span data-testid="artifact-panel-too-large">
          This file is {formatMib(query.data.size)} — too large to preview
          (limit {formatMib(MAX_ARTIFACT_PREVIEW_BYTES)}). Download it to open
          it outside Buzz.
        </span>
      </PanelNotice>
    );
  }

  const { text } = query.data;

  return (
    <Tabs
      className="pt-2"
      onValueChange={(value) => setArtifactTab(value as ArtifactPanelTab)}
      value={tab}
    >
      <TabsList className="mb-3">
        <TabsTrigger data-testid="artifact-tab-preview" value="preview">
          Preview
        </TabsTrigger>
        <TabsTrigger data-testid="artifact-tab-source" value="source">
          Source
        </TabsTrigger>
      </TabsList>

      <TabsContent value="preview">
        {sourceHasScript(text) ? (
          // Without this the artifact simply looks broken: the frame renders,
          // its scripts are silently refused by the inherited CSP, and nothing
          // tells the reader why. See docs/spike-csp-results.md §6.
          <Alert className="mb-3" data-testid="artifact-script-notice">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Scripts in this file are not run in the preview. It is shown as
              static content.
            </AlertDescription>
          </Alert>
        ) : null}
        <ArtifactFrame
          kind={target.artifact}
          text={text}
          title={`Preview of ${target.filename}`}
        />
      </TabsContent>

      <TabsContent value="source">
        <ArtifactSourceView text={text} />
      </TabsContent>
    </Tabs>
  );
}
