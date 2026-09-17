import { Skeleton } from "@/shared/ui/skeleton";

const LOADING_ROWS = ["one", "two", "three", "four", "five"] as const;

/** Section skeleton: only shown when there is nothing to show (R1). */
export function TowerLoadingState() {
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
      data-testid="tower-loading-state"
    >
      {LOADING_ROWS.map((row) => (
        <div
          className="grid gap-2 border-b border-border/50 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(7rem,1fr))] sm:gap-3"
          key={row}
        >
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}
