import * as React from "react";
import { RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { useAgentEvalSummariesQuery } from "../../skills/hooks";
import type { AgentEvalSummary } from "../../skills/types";
import {
  BulletinBlock,
  CasesBlock,
  DiscrepanciesBlock,
  FeedbackBlock,
} from "../../skills/ui/EvalBlocks";
import { computeEvalDashboardSummary } from "../lib/evalDashboardSummary";

/** Last N feedback-log entries shown per agent in the detail view (R2). */
const FEEDBACK_DETAIL_LIMIT = 5;

/**
 * Every agent's evals, one card per folder (R1, R3, R5) — I2 in
 * `PLANS/PLAN_SUITE_EVALS_UI_RENDIMIENTO.md`. Selecting a card opens its
 * detail in place (R2, R6, R7) — I3.
 *
 * Read-only: the manual refresh (R4, wired up in I4) is the only action.
 */
export function EvalDashboardView() {
  const query = useAgentEvalSummariesQuery();
  const [selectedDir, setSelectedDir] = React.useState<string | null>(null);

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden"
      data-testid="eval-dashboard-view"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-7 sm:px-6 sm:py-8"
        data-scroll-restoration-id="eval-dashboard"
      >
        <div className="mx-auto w-full max-w-6xl space-y-6 [container-type:inline-size]">
          <PageHeader
            action={
              <Button
                aria-label="Refresh evals"
                data-testid="eval-dashboard-refresh"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw
                  className={cn("h-4 w-4", query.isFetching && "animate-spin")}
                />
              </Button>
            }
            description="How each agent's evals are trending, read straight from disk."
            title="Agent evals"
          />

          {query.isPending ? (
            <EvalDashboardSkeleton />
          ) : query.isError ? (
            <EvalDashboardError
              message={
                query.error instanceof Error
                  ? query.error.message
                  : "Could not read the evals directory."
              }
              onRetry={() => void query.refetch()}
            />
          ) : (
            <EvalDashboardBody
              onSelectDir={(dirName) =>
                setSelectedDir((current) =>
                  current === dirName ? null : dirName,
                )
              }
              selectedDir={selectedDir}
              summaries={query.data}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EvalDashboardBody({
  onSelectDir,
  selectedDir,
  summaries,
}: {
  onSelectDir: (dirName: string) => void;
  selectedDir: string | null;
  summaries: AgentEvalSummary[];
}) {
  // Casos límite (PRD): la raíz no existe o no es legible viene de Rust como
  // una lista vacía (mismo contrato que `read_agent_evals`, §3), no como un
  // error — así que este estado vacío también cubre esa raíz ausente, y no
  // se puede distinguir "raíz ausente" de "sin agentes todavía" desde aquí.
  if (summaries.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 py-16 text-center text-muted-foreground"
        data-testid="eval-dashboard-empty"
      >
        <p className="text-sm">No agent evals found yet.</p>
        <p className="text-xs text-muted-foreground/80">
          Nothing under the evals directory — an agent's folder appears here
          once it has cases or a bulletin.
        </p>
      </div>
    );
  }

  const summary = computeEvalDashboardSummary(summaries);
  const selected = summaries.find((s) => s.dirName === selectedDir) ?? null;

  return (
    <div className="space-y-6">
      <EvalDashboardSummaryBar summary={summary} />
      <div
        className="grid grid-cols-1 gap-3 [@container(min-width:42rem)]:grid-cols-2 [@container(min-width:63rem)]:grid-cols-3"
        data-testid="eval-dashboard-grid"
      >
        {summaries.map((agentSummary) => (
          <AgentEvalCard
            isSelected={agentSummary.dirName === selectedDir}
            key={agentSummary.dirName}
            onSelect={() => onSelectDir(agentSummary.dirName)}
            summary={agentSummary}
          />
        ))}
      </div>
      {selected ? <AgentEvalDetail summary={selected} /> : null}
    </div>
  );
}

function EvalDashboardSummaryBar({
  summary,
}: {
  summary: ReturnType<typeof computeEvalDashboardSummary>;
}) {
  return (
    <div
      className="flex flex-wrap gap-6 rounded-xl border border-border/70 bg-background/70 px-4 py-3"
      data-testid="eval-dashboard-summary"
    >
      <SummaryStat
        label="Agents"
        testId="eval-dashboard-summary-agents"
        value={summary.totalAgents}
      />
      <SummaryStat
        label="Cases"
        testId="eval-dashboard-summary-cases"
        value={summary.totalCases}
      />
      <SummaryStat
        label="Regressions"
        testId="eval-dashboard-summary-regressions"
        value={summary.regressions}
        variant={summary.regressions > 0 ? "warning" : "default"}
      />
    </div>
  );
}

function SummaryStat({
  label,
  testId,
  value,
  variant = "default",
}: {
  label: string;
  testId: string;
  value: number;
  variant?: "default" | "warning";
}) {
  return (
    <div className="min-w-[5rem]">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          variant === "warning" && value > 0
            ? "text-destructive"
            : "text-foreground",
        )}
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  );
}

function AgentEvalCard({
  isSelected,
  onSelect,
  summary,
}: {
  isSelected: boolean;
  onSelect: () => void;
  summary: AgentEvalSummary;
}) {
  const casesByOrigin = new Map<string, number>();
  for (const evalCase of summary.cases) {
    casesByOrigin.set(
      evalCase.origin,
      (casesByOrigin.get(evalCase.origin) ?? 0) + 1,
    );
  }

  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background/70 p-4 text-left shadow-xs transition-colors hover:border-border",
        isSelected ? "border-primary" : "border-border/70",
      )}
      data-agent-dir={summary.dirName}
      data-testid="agent-eval-card"
      onClick={onSelect}
      type="button"
    >
      <p className="truncate font-mono text-sm font-medium text-foreground">
        {summary.dirName}
      </p>

      {summary.cases.length === 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="agent-eval-card-no-cases"
        >
          No cases yet.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {summary.cases.length} {summary.cases.length === 1 ? "case" : "cases"}
          {casesByOrigin.size > 0
            ? ` (${Array.from(casesByOrigin.entries())
                .map(([origin, count]) => `${count} ${origin}`)
                .join(", ")})`
            : null}
        </p>
      )}

      <BulletinSummary summary={summary} />
    </button>
  );
}

function BulletinSummary({ summary }: { summary: AgentEvalSummary }) {
  const bulletin = summary.bulletin;
  if (!bulletin) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="agent-eval-card-no-bulletin"
      >
        No bulletin yet.
      </p>
    );
  }

  const TrendIcon = bulletin.trend === "baja" ? TrendingDown : TrendingUp;
  const showTrendIcon = bulletin.trend === "sube" || bulletin.trend === "baja";

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
      data-testid="agent-eval-card-bulletin"
    >
      <span className="text-sm font-medium text-foreground">
        {bulletin.score}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 text-2xs",
          bulletin.trend === "baja"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
        data-testid="agent-eval-card-trend"
      >
        {showTrendIcon ? <TrendIcon className="h-3 w-3" /> : null}
        {bulletin.trend}
      </span>
    </div>
  );
}

/**
 * Per-agent detail (R2, R6, R7 — I3), rendered inline below the grid when a
 * card is selected. Reuses the same blocks as the profile's Evals section
 * (`EvalBlocks.tsx`) so cases, the bulletin's trend+date, and invalid-case /
 * invalid-bulletin handling render identically in both places — only the
 * feedback log is capped here to the 5 most recent entries (R2), which the
 * profile section shows in full.
 */
function AgentEvalDetail({ summary }: { summary: AgentEvalSummary }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-background/70"
      data-agent-dir={summary.dirName}
      data-testid="agent-eval-detail"
    >
      <div className="flex items-center justify-between border-b border-border/55 px-4 py-2.5">
        <p className="font-mono text-sm font-medium text-foreground">
          {summary.dirName}
        </p>
      </div>
      <div className="divide-y divide-border/55">
        <BulletinBlock evals={summary} />
        <CasesBlock cases={summary.cases} dir={summary.dir} />
        <FeedbackBlock
          entries={summary.feedback}
          limit={FEEDBACK_DETAIL_LIMIT}
        />
        <DiscrepanciesBlock discrepancies={summary.discrepancies} />
      </div>
    </div>
  );
}

function EvalDashboardSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-3 [@container(min-width:42rem)]:grid-cols-2 [@container(min-width:63rem)]:grid-cols-3"
      data-testid="eval-dashboard-skeleton"
    >
      {["first", "second", "third"].map((card) => (
        <div
          className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/70 p-4"
          key={card}
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function EvalDashboardError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground"
      data-testid="eval-dashboard-error"
    >
      <p className="text-sm text-red-400">{message}</p>
      <Button onClick={onRetry} size="sm" variant="outline">
        Retry
      </Button>
    </div>
  );
}
