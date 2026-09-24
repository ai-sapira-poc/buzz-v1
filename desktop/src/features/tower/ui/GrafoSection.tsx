import * as React from "react";

import { GrafoCanvas } from "./GrafoCanvas";
import { TowerEmptyState } from "./TowerEmptyState";
import { TowerErrorState, TowerStaleBanner } from "./TowerErrorState";
import { TowerLoadingState } from "./TowerLoadingState";
import { TowerNeedsAttention } from "./TowerNeedsAttention";
import type { HandoverView } from "./handoverState";
import { linesNeedingAttention, type PortfolioView } from "./portfolioState";

/**
 * The canvas, wrapped in the same section shell the portfolio uses: one phase,
 * one snapshot, the same four surface states.
 *
 * **This section carries no `aria-live` of its own.** `PanelSection` already
 * announces this read: both take the same {@link PortfolioView} phase, and
 * `buildPanelRows` maps the portfolio 1:1, so its count is this canvas's card
 * count. A second region here announced one transition twice — once in English,
 * once in Spanish. The canvas's own fact, what a layer means, is stated in the
 * note below, in document order; it only changes when the read does.
 *
 * The three state components (`TowerLoadingState`, `TowerEmptyState`,
 * `TowerErrorState`) are reused verbatim: the canvas and the row view describe
 * the same read, so a second copy of "reading", "empty" or "failed" would be a
 * second owner of the same message.
 *
 * The section carries the row view's spec §6 keyboard hand-off, because it
 * replaces that view on this screen: when the operator's own `Retry` resolves
 * into cards, focus moves to the first card — and only then. A plain
 * loading → data transition must not steal focus, and the stale banner's Retry
 * (which leaves the canvas mounted) must not pull focus out of wherever the
 * operator left it.
 */
export function GrafoSection({
  view,
  handovers,
}: {
  view: PortfolioView;
  /**
   * The edge read (the handoff edge). **Required** on purpose: a defaulted
   * `null` would let a caller's omission render as "there are no handoffs",
   * which is a claim only an empty read may make.
   */
  handovers: HandoverView;
}) {
  const { lines } = view;
  const hasLines = lines !== null && lines.length > 0;
  const attention = lines === null ? [] : linesNeedingAttention(lines);
  const showingStale = view.phase === "unreachable" && lines !== null;
  // An edge endpoint needs a window node to be an orphan *of*; with no window
  // there is nothing to be orphaned from, so the frozen empty state wins and no
  // orphan is drawn. The read is still named, without a figure — the read is
  // capped, so any count would be "what was read", not "what there is".
  const edgesWithoutWindow =
    lines !== null &&
    lines.length === 0 &&
    handovers.lines !== null &&
    handovers.lines.length > 0;

  const [focusCardPending, setFocusCardPending] = React.useState(false);
  const handleErrorRetry = React.useCallback(() => {
    setFocusCardPending(true);
    view.retry();
  }, [view.retry]);
  React.useEffect(() => {
    if (focusCardPending && hasLines) setFocusCardPending(false);
  }, [focusCardPending, hasLines]);
  const cancelHandoff = React.useCallback(() => setFocusCardPending(false), []);

  return (
    <section
      aria-label="Tower Control graph"
      className="flex flex-col gap-3"
      data-testid="tower-grafo"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Tower Control · graph</h2>
        {/* What the grouping truly is: depth in this window, derived from the
            handoff path — never an absolute hierarchy. */}
        <p
          className="text-2xs text-muted-foreground"
          data-testid="tower-grafo-grouping-note"
        >
          One column per depth in this window — the handoff path (the handoff
          edge) from one job to the next, not an absolute hierarchy. Arrows
          point from the parent job to the child it handed off to.
        </p>
      </div>

      {showingStale ? (
        <TowerStaleBanner
          lastSuccessAt={view.lastSuccessAt}
          onRetry={view.retry}
        />
      ) : null}
      <TowerNeedsAttention lines={attention} />
      {view.phase === "loading" && lines === null ? (
        <TowerLoadingState />
      ) : null}
      {/* Keyed on the snapshot, not on `ready`: a stale read whose last good
          result was empty must still explain itself under the stale banner. */}
      {lines !== null && lines.length === 0 ? <TowerEmptyState /> : null}
      {edgesWithoutWindow ? (
        <p
          className="text-2xs text-muted-foreground"
          data-testid="tower-grafo-no-window-note"
        >
          The handoff edge read did carry handoffs, but this window has no card
          to anchor them to, so none is drawn.
        </p>
      ) : null}
      {view.phase === "unreachable" && lines === null ? (
        <TowerErrorState
          failure={view.failure}
          onRetry={handleErrorRetry}
          onRetryBlur={cancelHandoff}
        />
      ) : null}
      {hasLines && lines !== null ? (
        <GrafoCanvas
          focusOnMount={focusCardPending && hasLines}
          handovers={handovers}
          lines={lines}
        />
      ) : null}
    </section>
  );
}
