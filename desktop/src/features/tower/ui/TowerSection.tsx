import { TowerNeedsAttention } from "./TowerNeedsAttention";
import { TowerSectionBody } from "./TowerSectionBody";
import { TowerStaleBanner } from "./TowerErrorState";
import { linesNeedingAttention, type PortfolioView } from "./portfolioState";

/**
 * Section composition. The error-with-snapshot branch (R6) keeps the previous
 * list and announces at the top that it is old; the error-without-snapshot
 * branch (R5) replaces the list entirely and shows no figure. The two are
 * decided in {@link PortfolioView}, not here.
 */
export function TowerSection({ view }: { view: PortfolioView }) {
  const attention = view.lines ? linesNeedingAttention(view.lines) : [];
  const showingStale = view.phase === "unreachable" && view.lines !== null;

  return (
    <section
      aria-label="Tower Control portfolio"
      className="flex flex-col gap-3"
    >
      {showingStale ? (
        <TowerStaleBanner
          lastSuccessAt={view.lastSuccessAt}
          onRetry={view.retry}
        />
      ) : null}
      <TowerNeedsAttention lines={attention} />
      <TowerSectionBody view={view} />
    </section>
  );
}
