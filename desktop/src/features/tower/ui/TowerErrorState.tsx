import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { clockUtc } from "@/features/panel/ui/panelClock";
import { portfolioFallSentence } from "@/features/panel/ui/portfolioFallPhrase";
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
 * The sentence is the portfolio read's one fall phrase (§1.1 rule 2), shared
 * with the panel's notice: the same read cannot reach the operator as two
 * sentences about the same instant. It names the read's hour through
 * {@link clockUtc} rather than the instant it carried, so the card and the
 * panel print the same clock (§1). The title and the action stay this surface's
 * own; the fall phrase is the sentence.
 */
export function TowerStaleBanner({
  lastSuccessAt,
  lastGoodWasEmpty = false,
  code,
  onRetry,
}: {
  lastSuccessAt: string | null;
  /**
   * The preserved snapshot held no encargos. The shared sentence then cannot
   * promise the cards below it — the panel's branch for the same fact.
   */
  lastGoodWasEmpty?: boolean;
  /** The adapter's citable failure code, or `null` when it gave none. */
  code: string | null;
  onRetry: () => void;
}) {
  const clock = clockUtc(lastSuccessAt);
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="tower-stale-banner">
      <AlertTitle>The telemetry source is not responding</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>{portfolioFallSentence(clock, lastGoodWasEmpty)}</span>
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
