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
 * and announce at the top that they are old — naming *when* that read happened,
 * so the operator can weigh it, and which failure produced it, by its citable
 * code. The retry lives where the problem is, not in the page header.
 *
 * The instant is printed as the read carried it (`portfolioState.lastSuccessAt`)
 * rather than as a relative age: a relative age is computed against the render's
 * clock, so the same props read differently a moment later and the DOM no longer
 * says when the data is from. The panel's notice for this same read names the
 * same instant the same way — one read, one fall phrase (§1.1), not two that
 * disagree about when the data is from.
 */
export function TowerStaleBanner({
  lastSuccessAt,
  code,
  onRetry,
}: {
  lastSuccessAt: string | null;
  /** The adapter's citable failure code, or `null` when it gave none. */
  code: string | null;
  onRetry: () => void;
}) {
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="tower-stale-banner">
      <AlertTitle>The telemetry source is not responding</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {lastSuccessAt
            ? `Showing the last good read, at ${lastSuccessAt}; it is not current.`
            : "Showing the last good read; it is not current."}
        </span>
        {/* The code the adapter produced. `null` means it supplied none: the
            notice then says nothing rather than coining one. */}
        {code ? (
          <code className="font-mono text-2xs text-muted-foreground">
            code: {code}
          </code>
        ) : null}
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
