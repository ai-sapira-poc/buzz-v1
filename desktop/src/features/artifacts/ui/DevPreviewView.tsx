import * as React from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/shared/ui/button";
import type { ArtifactTarget } from "../artifactPanelStore";

/**
 * SECURITY — a live dev server is framed with `allow-scripts allow-forms` and
 * deliberately WITHOUT `allow-same-origin`, so the frame holds an opaque origin
 * and cannot reach the app's storage, cookies or relay session.
 *
 * `allow-forms` is the one concession over the artifact frame: a dev server is
 * an app under development, and a preview where nothing can be submitted is of
 * little use. It grants form submission inside the opaque origin, nothing more.
 *
 * **Do not add `allow-same-origin`.** Doing so for a loopback frame is a
 * materially weaker posture than Milestone A2 and is a separate decision with
 * its own review — see `docs/plan-artifact-preview.md` §8.6. Some dev servers
 * (anything needing localStorage, or Vite's HMR socket) will misbehave without
 * it; that is the expected trade and must not be "fixed" here.
 */
export const DEV_PREVIEW_SANDBOX = "allow-scripts allow-forms";

/** How long to wait for the server before calling it unreachable. */
const PROBE_TIMEOUT_MS = 3000;

type Probe = "checking" | "ready" | "unreachable";

/**
 * Ask whether anything is listening, before framing it.
 *
 * `no-cors` means the response is opaque and its contents unreadable — which is
 * all this needs. It resolves when the connection succeeds and rejects when it
 * is refused, which is exactly the question being asked. Without this a dead
 * port renders as a silent blank frame that looks like a product bug.
 */
async function probeServer(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    await fetch(url, { mode: "no-cors", signal });
    return true;
  } catch {
    return false;
  }
}

export function DevPreviewView({
  target,
}: {
  target: Extract<ArtifactTarget, { kind: "devServer" }>;
}) {
  const [probe, setProbe] = React.useState<Probe>("checking");
  // Bumped by Reload and Retry; remounts the frame and re-runs the probe.
  const [attempt, setAttempt] = React.useState(0);

  // Reload and Try again bump `attempt`, which changes this key and so re-runs
  // the probe against the same URL. Folding it into the key keeps it a real
  // dependency the effect reads, rather than one carried by a suppression.
  const probeKey = `${attempt}\u0000${target.url}`;

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    setProbe("checking");

    const url = probeKey.slice(probeKey.indexOf("\u0000") + 1);
    probeServer(url, controller.signal).then((reachable) => {
      clearTimeout(timer);
      if (!controller.signal.aborted || reachable) {
        setProbe(reachable ? "ready" : "unreachable");
      } else {
        setProbe("unreachable");
      }
    });

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [probeKey]);

  const retry = () => setAttempt((n) => n + 1);

  return (
    <div className="flex flex-col gap-2 pt-2" data-testid="dev-preview-view">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground"
          data-testid="dev-preview-url"
          title={target.url}
        >
          {target.url}
        </span>
        <Button
          aria-label="Reload preview"
          data-testid="dev-preview-reload"
          onClick={retry}
          size="icon-xs"
          variant="ghost"
        >
          <RotateCw />
        </Button>
        <Button
          aria-label="Open in browser"
          data-testid="dev-preview-external"
          onClick={() => {
            void openUrl(target.url).catch(() => {});
          }}
          size="icon-xs"
          variant="ghost"
        >
          <ExternalLink />
        </Button>
      </div>

      {probe === "checking" ? (
        <div
          className="h-[calc(100vh-16rem)] w-full animate-pulse rounded-lg bg-muted/40"
          data-testid="dev-preview-checking"
        />
      ) : null}

      {probe === "unreachable" ? (
        <div
          className="flex h-[calc(100vh-16rem)] w-full flex-col items-center justify-center gap-3 rounded-lg border border-border/60 bg-muted/20 text-center"
          data-testid="dev-preview-error"
        >
          <p className="max-w-xs text-sm text-muted-foreground">
            Nothing is answering on{" "}
            <span className="font-mono">localhost:{target.port}</span>. The
            server may still be starting, or it may have stopped.
          </p>
          <Button
            data-testid="dev-preview-retry"
            onClick={retry}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}

      {probe === "ready" ? (
        <iframe
          className="h-[calc(100vh-16rem)] w-full rounded-lg border border-border/60 bg-white"
          data-testid="dev-preview-frame"
          key={attempt}
          referrerPolicy="no-referrer"
          sandbox={DEV_PREVIEW_SANDBOX}
          src={target.url}
          title={`Preview of ${target.url}`}
        />
      ) : null}
    </div>
  );
}
