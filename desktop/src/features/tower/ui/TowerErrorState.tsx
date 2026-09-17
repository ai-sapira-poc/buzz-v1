import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import type { TowerFailure } from "./portfolioState";

/**
 * The source cannot be read and there is no previous snapshot: the section
 * shows no figure at all. A failed adapter read is never painted as current
 * data. `Alert` already carries `role="alert"` in this design system, so no
 * second role is added here.
 */
export function TowerErrorState({
  failure,
  onRetry,
  onRetryBlur,
}: {
  failure: TowerFailure | null;
  onRetry: () => void;
  /**
   * Fired when focus lands on another element while the retry button is still
   * on screen — the operator moved on, so the pending hand-off must cancel
   * (spec §6). A `relatedTarget` of `null` means the button itself is leaving
   * the document (the list replaced it), which must NOT cancel.
   */
  onRetryBlur?: () => void;
}) {
  return (
    <Alert
      className="flex flex-col gap-1.5"
      data-testid="tower-error-state"
      variant="destructive"
    >
      <AlertTitle>Could not read the telemetry source</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          The adapter failed to return a portfolio. A read failure is not shown
          as stale data.
        </span>
        {failure?.code ? (
          <code className="font-mono text-2xs text-muted-foreground">
            code: {failure.code}
          </code>
        ) : null}
        <Button
          className="self-start"
          onBlur={(event) => {
            if (event.relatedTarget) onRetryBlur?.();
          }}
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The source cannot be read but a previous read is on screen: keep the lines,
 * and announce at the top that they are old. The retry lives where the problem
 * is, not in the page header.
 */
export function TowerStaleBanner({
  lastSuccessAt,
  onRetry,
}: {
  lastSuccessAt: string | null;
  onRetry: () => void;
}) {
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="tower-stale-banner">
      <AlertTitle>The telemetry source is not responding</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {lastSuccessAt
            ? `Showing data read ${formatStaleAt(lastSuccessAt)}; it is not current.`
            : "Showing the last data read; it is not current."}
        </span>
        <Button
          className="self-start"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function formatStaleAt(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "earlier";
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}
