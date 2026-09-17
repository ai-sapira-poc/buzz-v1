import * as React from "react";

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
  const hasLines = view.lines !== null && view.lines.length > 0;

  // Spec §6: focus follows the operator's own Retry into the list, and only
  // then — never while the read is still in flight, and never on a plain
  // loading → data transition, which would steal focus from wherever it was.
  const [focusListPending, setFocusListPending] = React.useState(false);
  const handleErrorRetry = React.useCallback(() => {
    setFocusListPending(true);
    view.retry();
  }, [view.retry]);
  React.useEffect(() => {
    if (focusListPending && hasLines) setFocusListPending(false);
  }, [focusListPending, hasLines]);
  const cancelHandoff = React.useCallback(() => setFocusListPending(false), []);

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
      <TowerSectionBody
        focusListOnMount={focusListPending && hasLines}
        onErrorRetry={handleErrorRetry}
        onErrorRetryBlur={cancelHandoff}
        view={view}
      />
    </section>
  );
}
