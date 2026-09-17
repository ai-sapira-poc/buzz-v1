import * as React from "react";

import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import type {
  PortfolioLine,
  WorkState,
} from "@/features/tower/domain/portfolio";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { formatRecency, formatTokens } from "./portfolioFormat";

function BlockedCell({ line }: { line: PortfolioLine }) {
  const { count, basis } = line.blocked;
  if (basis === null) {
    // No basis: the section must not claim "blocked". Absence is information.
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">Unknown</span>
        <span className="text-2xs text-muted-foreground">
          no blocked signal available
        </span>
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">None blocked</span>
        <span className="text-2xs text-muted-foreground">
          {basis === "inferred" ? "inferred" : "observed"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="text-sm font-medium">{count} blocked</span>
      {basis === "observed" ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive">blocked</Badge>
            </TooltipTrigger>
            <TooltipContent>
              Supported by the run span that reported it.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Badge variant="warning">inference</Badge>
      )}
      <span className="font-mono text-2xs text-muted-foreground">
        {basis === "inferred"
          ? "run.id = trace_id · derived state, not a span signal"
          : "run.id = trace_id"}
      </span>
    </div>
  );
}

function CostCell({ line }: { line: PortfolioLine }) {
  const { cost } = line;
  if (cost === null) {
    // Never "0 tok": an illegible cost is absence, not a measured zero.
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">Not available</span>
        <span className="text-2xs text-muted-foreground">
          no readable spend under this owner
        </span>
      </div>
    );
  }

  const { observedAgents, totalAgents } = cost.coverage;
  const partial = observedAgents < totalAgents;
  const totalTokens = cost.inputTokens + cost.outputTokens;

  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="text-sm font-medium">
        {formatTokens(totalTokens)} tok
      </span>
      <span
        className={cn(
          "rounded-sm border px-1 text-2xs",
          partial
            ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "border-border/60 bg-muted/40 text-muted-foreground",
        )}
      >
        {totalAgents === 0
          ? "no agents in scope"
          : partial
            ? `observed ${observedAgents} of ${totalAgents} agents`
            : `${totalAgents} agents`}
      </span>
      <span className="text-2xs text-muted-foreground">
        Σ tokens of readable spans under this owner
      </span>
    </div>
  );
}

const WORK_STATE_LABEL: Record<WorkState, string> = {
  requested: "Requested",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function WorkLine({ line }: { line: PortfolioLine }) {
  const { work } = line;
  if (work === null) {
    return null;
  }
  return (
    <span className="truncate text-2xs text-muted-foreground">
      {WORK_STATE_LABEL[work.state]}
      {work.summary === null ? "" : ` · ${work.summary}`}
    </span>
  );
}

type PortfolioRowProps = {
  line: PortfolioLine;
} & React.ComponentPropsWithoutRef<"li">;

/**
 * One supervisory line, read as a sentence: the project is the object, recency
 * is the verb, the blocked column is the outcome. Fixed by
 * `tower/fila-cartera.html`; this is the projection, not a redesign.
 *
 * The row is not a control (Fase 1): it is focusable only so the list can be
 * traversed with the keyboard. Focus lives on the row and the visible ring
 * follows it — the roving tabindex lives in {@link TowerPortfolioList}.
 */
export const PortfolioRow = React.forwardRef<HTMLLIElement, PortfolioRowProps>(
  function PortfolioRow({ line, className, ...rest }, ref) {
    const recency = formatRecency(line.recency.lastSpanAt);
    return (
      <li
        className={cn(
          "grid gap-2 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(7rem,1fr))] sm:gap-3",
          className,
        )}
        data-testid="tower-portfolio-row"
        ref={ref}
        {...rest}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {line.project.name}
          </span>
          <span className="truncate font-mono text-2xs text-muted-foreground">
            {line.project.id}
          </span>
          <WorkLine line={line} />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              "text-sm",
              recency === null && "text-muted-foreground",
            )}
          >
            {recency ?? "No readable signal"}
          </span>
          <span className="text-2xs text-muted-foreground">
            silence ≠ inactivity
          </span>
        </div>
        <BlockedCell line={line} />
        <CostCell line={line} />
      </li>
    );
  },
);
