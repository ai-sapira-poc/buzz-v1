import { GrafoCanvas } from "./GrafoCanvas";
import { TowerEmptyState } from "./TowerEmptyState";
import { TowerErrorState, TowerStaleBanner } from "./TowerErrorState";
import { TowerLoadingState } from "./TowerLoadingState";
import { TowerNeedsAttention } from "./TowerNeedsAttention";
import { linesNeedingAttention, type PortfolioView } from "./portfolioState";

/**
 * The canvas, wrapped in the same section shell the portfolio uses: one phase,
 * one snapshot, the same four surface states, and **one** `aria-live` region
 * per phase change.
 *
 * The three state components (`TowerLoadingState`, `TowerEmptyState`,
 * `TowerErrorState`) are reused verbatim: the canvas and the row view describe
 * the same read, so a second copy of "reading", "empty" or "failed" would be a
 * second owner of the same message. This section is the read's only mount.
 */
function announcementFor(view: PortfolioView): string {
  if (view.phase === "loading") {
    return view.lines === null
      ? "Reading the agent work"
      : cardCountLabel(view.lines.length);
  }
  if (view.phase === "unreachable") {
    return "Could not read the agent work";
  }
  if (view.lines === null || view.lines.length === 0) {
    return "No cards to draw";
  }
  return cardCountLabel(view.lines.length);
}

function cardCountLabel(count: number): string {
  return count === 1 ? "1 card" : `${count} cards`;
}

export function GrafoSection({ view }: { view: PortfolioView }) {
  const { lines } = view;
  const hasLines = lines !== null && lines.length > 0;
  const attention = lines === null ? [] : linesNeedingAttention(lines);
  const showingStale = view.phase === "unreachable" && lines !== null;

  return (
    <section
      aria-label="Tower Control graph"
      className="flex flex-col gap-3"
      data-testid="tower-grafo"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Tower Control · graph</h2>
        {/* What the grouping truly is, and where depth will come from, so no
            reader mistakes the columns for a hierarchy. */}
        <p
          className="text-2xs text-muted-foreground"
          data-testid="tower-grafo-grouping-note"
        >
          One column per role the producer named — the role each job carries,
          not the depth of the work. Depth is the handoff from one job to the
          next; the handoff edges are not drawn on this surface yet.
        </p>
      </div>

      <p
        aria-live="polite"
        className="sr-only"
        data-testid="tower-grafo-status-announcement"
      >
        {announcementFor(view)}
      </p>

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
      {view.phase === "unreachable" && lines === null ? (
        <TowerErrorState failure={view.failure} onRetry={view.retry} />
      ) : null}
      {hasLines && lines !== null ? <GrafoCanvas lines={lines} /> : null}
    </section>
  );
}
