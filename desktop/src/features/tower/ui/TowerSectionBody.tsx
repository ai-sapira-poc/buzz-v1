import { TowerEmptyState } from "./TowerEmptyState";
import { TowerErrorState } from "./TowerErrorState";
import { TowerLoadingState } from "./TowerLoadingState";
import { TowerPortfolioList } from "./TowerPortfolioList";
import type { PortfolioView } from "./portfolioState";

function lineCountLabel(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}

function announcementFor(view: PortfolioView): string {
  if (view.phase === "loading") {
    return view.lines === null
      ? "Loading lines"
      : lineCountLabel(view.lines.length);
  }
  if (view.phase === "unreachable") {
    return "Could not read the telemetry source";
  }
  if (view.lines === null || view.lines.length === 0) {
    return "No lines to show";
  }
  return lineCountLabel(view.lines.length);
}

/**
 * Branches on the phase/snapshot pair. Holds the section's single
 * `aria-live="polite"` region — one announcement per phase change, never one
 * per row.
 */
export function TowerSectionBody({ view }: { view: PortfolioView }) {
  const { lines } = view;
  const hasLines = lines !== null && lines.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <p
        aria-live="polite"
        className="sr-only"
        data-testid="tower-status-announcement"
      >
        {announcementFor(view)}
      </p>
      {view.phase === "loading" && lines === null ? (
        <TowerLoadingState />
      ) : null}
      {/* Keyed on the snapshot, not on `ready`: a stale read whose last
          successful result was empty (`unreachable` + `lines: []`) must still
          explain itself under the stale banner rather than render blank. */}
      {lines !== null && lines.length === 0 ? <TowerEmptyState /> : null}
      {view.phase === "unreachable" && lines === null ? (
        <TowerErrorState failure={view.failure} onRetry={view.retry} />
      ) : null}
      {hasLines && lines !== null ? (
        <TowerPortfolioList lines={lines} refreshing={view.refreshing} />
      ) : null}
    </div>
  );
}
