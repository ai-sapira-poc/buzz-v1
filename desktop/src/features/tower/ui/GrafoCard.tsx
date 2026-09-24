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
 * admitted state has no producer either, and the card does not draw it as a
 * state at all — see {@link stateLabel}.
 *
 * The card names the **role** as well as the job. D1 replaced the column per
 * role with a layer per depth, so the role no longer has a heading to live in:
 * if it did not ride the card, the operator would lose who does each job. That
 * is a declared supersession of S1, not a silent regression.
 *
 * The card draws no edge: the connector belongs to the edge layer, in the same
 * transformed world as this card, so a card can never disagree with its arrow
 * about where it is.
 */

/**
 * The four states S1 draws: each one has a caller emitting its kind today
 * (taxonomy §2). The fifth state the fold admits, `requested`, is not one of
 * them — see {@link stateLabel}.
 */
type DrawnWorkState = Exclude<WorkState, "requested">;

const WORK_STATE_LABEL: Record<DrawnWorkState, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * The chip's text. `work: null` is "nothing was said", which is not the same as
 * a state nobody produced: the absence still needs naming, in its own words and
 * without borrowing the vocabulary of a state someone measured.
 *
 * `requested` is the one state outside that vocabulary. The fold maps its kind
 * to it (`towerJobFold.ts`), but no caller publishes that kind (taxonomy §2),
 * so on real data nobody produces it — only a fixture can seed it, and a
 * fixture is not evidence of a producer. Printing "Requested" would present an
 * unobserved state as a measured one, and fusing it with `running` would be
 * worse, so the line is named as the absence it is: its own text, no figure,
 * never a state label (taxonomy §9). The label goes back the day a caller of
 * `created` exists — the fold itself is not touched, so that day the state
 * arrives here already folded.
 */
function stateLabel(work: PortfolioLine["work"]): string {
  if (work === null) return "No run reported";
  if (work.state === "requested") return "No signal";
  return WORK_STATE_LABEL[work.state];
}

/**
 * The left edge colour is the state the producer reported, or the neutral
 * border when no state was reported at all — `work: null` is "nothing was
 * said", and a state outside the drawn vocabulary is a state nobody produced,
 * so neither borrows the colour of a state someone observed.
 */
const STATE_EDGE: Record<DrawnWorkState, string> = {
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
  /** The role exactly as the read named it, or the unnamed placeholder. */
  roleName: string;
} & React.ComponentPropsWithoutRef<"li">;

/**
 * Focusable only so the canvas can be traversed with the keyboard; the card is
 * read-only (Fase 1) and the roving tabindex lives in {@link GrafoCanvas}.
 */
export const GrafoCard = React.forwardRef<HTMLLIElement, GrafoCardProps>(
  function GrafoCard({ line, roleName, className, ...rest }, ref) {
    const { work, waiting } = line;
    const recency = formatRecency(line.recency.lastSpanAt);
    return (
      <li
        className={cn(
          "flex min-w-0 flex-col gap-2 rounded-xl border border-l-4 border-border/70 bg-card/60 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          work === null || work.state === "requested"
            ? "border-l-border"
            : STATE_EDGE[work.state],
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

        <span
          className="min-w-0 truncate text-xs font-medium"
          data-testid="tower-node-role"
        >
          {roleName}
        </span>

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
