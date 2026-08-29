import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { sourceHasScript } from "../artifactDocument";
import {
  type ArtifactPanelTab,
  setArtifactTab,
  trustArtifact,
  useArtifactPanel,
} from "../artifactPanelStore";
import {
  MAX_ARTIFACT_PREVIEW_BYTES,
  useArtifactSource,
} from "../useArtifactSource";
import { ArtifactFrame } from "./ArtifactFrame";
import { ArtifactSourceView } from "./ArtifactSourceView";
import { DevPreviewView } from "./DevPreviewView";

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
  const { target, tab, trusted } = useArtifactPanel();
  const query = useArtifactSource(target);

  if (!target) return null;

  // A live dev server has no bytes to fetch and no run gate: it is already
  // running code the user started themselves. It gets its own view.
  if (target.kind === "devServer") return <DevPreviewView target={target} />;

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
        {sourceHasScript(text) && !trusted ? (
          // Without this the artifact simply looks broken: the frame renders,
          // its scripts are silently refused by the inherited CSP, and nothing
          // tells the reader why. See docs/spike-csp-results.md §6.
          <Alert className="mb-3" data-testid="artifact-script-notice">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                This file contains scripts. They are not run — it is shown as
                static content.
              </span>
              <Button
                data-testid="artifact-run"
                onClick={trustArtifact}
                size="sm"
                variant="outline"
              >
                Run this file
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {trusted ? (
          <Alert className="mb-3" data-testid="artifact-running-notice">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Running this file's scripts. It is isolated: it cannot reach your
              session or the network.
            </AlertDescription>
          </Alert>
        ) : null}
        <ArtifactFrame
          kind={target.artifact}
          text={text}
          title={`Preview of ${target.filename}`}
          trusted={trusted}
        />
      </TabsContent>

      <TabsContent value="source">
        <ArtifactSourceView text={text} />
      </TabsContent>
    </Tabs>
  );
}
