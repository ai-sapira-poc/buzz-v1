import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";

/**
 * The single surface that answers "does it need me?" without reading every
 * row. Rendered only when a line actually reports a blocked run — when none
 * does, nothing is drawn, because a green "all good" would be an unmeasured
 * assertion.
 */
export function TowerNeedsAttention({ lines }: { lines: PortfolioLine[] }) {
  if (lines.length === 0) return null;
  const names = lines.map((line) => line.project.name).join(", ");
  return (
    <Alert
      className="border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      data-testid="tower-needs-attention"
    >
      <AlertTitle>
        {lines.length === 1
          ? "1 line needs you"
          : `${lines.length} lines need you`}
      </AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-300">
        {names}
      </AlertDescription>
    </Alert>
  );
}
