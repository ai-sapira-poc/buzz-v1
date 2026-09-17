import { Radar } from "lucide-react";

/**
 * The section before the first run: the source is healthy and there are no
 * lines. Not an error, and nothing the operator can do from here — the copy
 * explains the mechanism instead of offering a false action.
 */
export function TowerEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center"
      data-testid="tower-empty-state"
    >
      <Radar aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No lines to show yet</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Tower Control reads the spans of your agents. When the first run emits a
        span, its line appears here without a reload.
      </p>
    </div>
  );
}
