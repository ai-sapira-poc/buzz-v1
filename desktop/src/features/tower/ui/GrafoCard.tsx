import * as React from "react";

import { cn } from "@/shared/lib/cn";
import type {
  PortfolioLine,
  WaitingReason,
  WorkState,
} from "@/features/tower/domain/portfolio";
import { formatRecency, formatTokens } from "./portfolioFormat";

/**
 * One unit of work on the canvas: a card, not a row.
 *
 * What the card says is exactly what the read can support — the job's own
 * identity, the state the producer reported, the producer's own line, the
 * recorded wait if one was published, the last readable instant, and the model
 * and spend. The last two have no producer on this read, so the card prints
 * "Not available" for them; it never prints `$0` and never sums a total. One
 * reported state has no producer either, and says so: see
 * {@link STATES_WITHOUT_PRODUCER}.
 *
 * The card draws no edge: S1 has no edge reader mounted on this surface, and a
 * connector invented here would be a claim the data does not make.
 */

const WORK_STATE_LABEL: Record<WorkState, string> = {
  requested: "Requested",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * The one legible state with no caller emitting it today: the fold admits
 * `requested`, but nothing publishes the kind that folds to it (taxonomy §2),
 * so on real data nobody produces this state — only a fixture can seed it, and
 * a fixture is not evidence of a producer. The card therefore refuses to
 * present it as a state someone measured: it carries the mark below, in words,
 * with no figure. Empty this set the day a producer exists.
 */
const STATES_WITHOUT_PRODUCER = new Set<WorkState>(["requested"]);

/**
 * The chip's text. `work: null` is "nothing was said", which is not the same as
 * the mark: a state nobody emitted still needs naming, but as unobserved.
 */
function stateLabel(work: PortfolioLine["work"]): string {
  if (work === null) return "No run reported";
  const label = WORK_STATE_LABEL[work.state];
  return STATES_WITHOUT_PRODUCER.has(work.state)
    ? `${label} · no producer today`
    : label;
}

/**
 * The left edge colour is the state the producer reported, or the neutral
 * border when no state was reported at all — `work: null` is "nothing was
 * said", which must not borrow the colour of a state nobody observed.
 */
const STATE_EDGE: Record<WorkState, string> = {
  requested: "border-l-sky-500/70",
  running: "border-l-emerald-500/70",
  done: "border-l-border",
  failed: "border-l-destructive/70",
  cancelled: "border-l-border",
};

const WAITING_LABEL: Record<WaitingReason, string> = {
  ladder_exhausted: "the automated ladder gave up",
  capability_denied: "it needs a capability it does not have",
};

/**
 * The one string the card prints where no figure exists. Shared with the
 * portfolio row on purpose: the operator learns it once.
 */
export const NOT_AVAILABLE = "Not available";

function costText(line: PortfolioLine): string {
  const { cost } = line;
  if (cost === null) return NOT_AVAILABLE;
  // Never a bare total: the readable spend travels with its coverage, so a sum
  // over a subset cannot be read as the whole.
  const { observedAgents, totalAgents } = cost.coverage;
  const tokens = formatTokens(cost.inputTokens + cost.outputTokens);
  return totalAgents === 0
    ? `${tokens} tok · no agents in scope`
    : `${tokens} tok · observed ${observedAgents} of ${totalAgents} agents`;
}

type GrafoCardProps = {
  line: PortfolioLine;
} & React.ComponentPropsWithoutRef<"li">;

/**
 * Focusable only so the canvas can be traversed with the keyboard; the card is
 * read-only (Fase 1) and the roving tabindex lives in {@link GrafoCanvas}.
 */
export const GrafoCard = React.forwardRef<HTMLLIElement, GrafoCardProps>(
  function GrafoCard({ line, className, ...rest }, ref) {
    const { work, waiting } = line;
    const recency = formatRecency(line.recency.lastSpanAt);
    return (
      <li
        className={cn(
          "flex min-w-0 flex-col gap-2 rounded-xl border border-l-4 border-border/70 bg-card/60 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          work === null ? "border-l-border" : STATE_EDGE[work.state],
          className,
        )}
        data-testid="tower-node"
        ref={ref}
        {...rest}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
            {line.project.id}
          </span>
          <span
            className="shrink-0 rounded-sm border border-border/60 bg-muted/40 px-1 text-2xs"
            data-testid="tower-node-state"
          >
            {stateLabel(work)}
          </span>
        </div>

        {work?.summary ? (
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {work.summary}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            The producer published no line for this job.
          </p>
        )}

        {waiting ? (
          <p className="text-2xs text-amber-700 dark:text-amber-300">
            <span className="font-medium">At rest</span> ·{" "}
            {WAITING_LABEL[waiting.reason]}
          </p>
        ) : null}

        <dl className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>Last activity</dt>
            <dd className={cn(!recency && "italic")}>
              {recency ?? "No readable signal"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Model</dt>
            <dd data-testid="tower-node-model">{NOT_AVAILABLE}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Cost</dt>
            <dd data-testid="tower-node-cost">{costText(line)}</dd>
          </div>
        </dl>
      </li>
    );
  },
);
