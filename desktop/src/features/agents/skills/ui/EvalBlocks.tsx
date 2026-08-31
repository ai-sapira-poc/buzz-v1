import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Markdown } from "@/shared/ui/markdown";
import type { AgentEvals, EvalCase, FeedbackEntry } from "../types";

/**
 * The read-only building blocks of an agent's evals (§3), shared by the
 * profile's `AgentEvalsSection` and the eval dashboard's per-agent detail
 * view (I3, `PLANS/PLAN_SUITE_EVALS_UI_RENDIMIENTO.md`). Extracted rather
 * than duplicated so both surfaces render the same contract the same way.
 *
 * Nothing here writes.
 */

export const ORIGIN_LABELS: Record<string, string> = {
  nacimiento: "at birth",
  feedback: "from feedback",
};

export const STATUS_CLASSES: Record<string, string> = {
  abierto: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  corregido: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  descartado: "bg-muted text-muted-foreground",
};

export function BulletinBlock({ evals }: { evals: AgentEvals }) {
  const bulletin = evals.bulletin;
  if (!bulletin) {
    return (
      <div className="px-4 py-2">
        <p className="text-sm text-muted-foreground">
          No bulletin yet — the runner has not scored these cases.
        </p>
      </div>
    );
  }

  const TrendIcon = bulletin.trend === "baja" ? TrendingDown : TrendingUp;
  const showTrendIcon = bulletin.trend === "sube" || bulletin.trend === "baja";
  const invalid = bulletin.problems.length > 0;

  return (
    <div className="px-4 py-2" data-testid="agent-evals-bulletin">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-2xs uppercase tracking-wide text-muted-foreground">
          Latest bulletin
        </p>
        <span
          className="font-medium text-sm text-foreground"
          data-testid="agent-evals-score"
        >
          {bulletin.score}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-2xs",
            bulletin.trend === "baja"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          data-testid="agent-evals-trend"
        >
          {showTrendIcon ? <TrendIcon className="h-3 w-3" /> : null}
          {bulletin.trend}
        </span>
        <span className="text-2xs text-muted-foreground/80">
          {bulletin.date} · {bulletin.runner}
        </span>
        {invalid ? (
          <span
            className="rounded-sm bg-destructive/10 px-1 py-px text-3xs text-destructive"
            data-testid="agent-evals-bulletin-invalid"
          >
            invalid
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-2xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-3 font-normal">Case</th>
              <th className="pr-3 font-normal">Score</th>
              <th className="font-normal">Note</th>
            </tr>
          </thead>
          <tbody>
            {bulletin.rows.map((row) => (
              <tr data-case={row.case} key={row.case}>
                <td className="pr-3 font-mono text-foreground">{row.case}</td>
                <td className="pr-3 text-foreground">{row.score}</td>
                <td className="text-muted-foreground">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invalid ? (
        <div className="mt-1.5" data-testid="agent-evals-bulletin-problems">
          <p className="font-mono text-3xs text-muted-foreground/70">
            {evals.dir}/boletin-ultimo.md
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {bulletin.problems.map((problem) => (
              <li className="text-2xs text-destructive" key={problem.code}>
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function CasesBlock({ cases, dir }: { cases: EvalCase[]; dir: string }) {
  if (cases.length === 0) {
    return (
      <div className="px-4 py-2">
        <p className="text-sm text-muted-foreground">No cases yet.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-2">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        Cases ({cases.length})
      </p>
      <div className="mt-1 space-y-1">
        {cases.map((evalCase) => (
          <CaseRow dir={dir} evalCase={evalCase} key={evalCase.fileName} />
        ))}
      </div>
    </div>
  );
}

export function CaseRow({
  dir,
  evalCase,
}: {
  dir: string;
  evalCase: EvalCase;
}) {
  const [open, setOpen] = React.useState(false);
  const id = `caso-${String(evalCase.number).padStart(2, "0")}`;
  const invalid = evalCase.problems.length > 0;

  return (
    <div data-case={id} data-testid="agent-eval-case">
      <button
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 rounded-md px-1 py-1 text-left hover:bg-muted/40"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-2xs text-muted-foreground">
              {id}
            </span>
            <span className="font-medium text-sm text-foreground">
              {evalCase.title}
            </span>
            <span
              className="rounded-sm bg-muted px-1 py-px text-3xs text-muted-foreground"
              data-testid="agent-eval-origin"
            >
              {ORIGIN_LABELS[evalCase.origin] ?? evalCase.origin}
            </span>
            {invalid ? (
              <span
                className="rounded-sm bg-destructive/10 px-1 py-px text-3xs text-destructive"
                data-testid="agent-eval-case-invalid"
              >
                invalid
              </span>
            ) : null}
          </span>
          <span className="text-2xs text-muted-foreground/80">
            {evalCase.date} · {evalCase.author}
          </span>
        </span>
      </button>

      {open ? (
        <div className="mb-2 ml-5 mt-1 space-y-2">
          {invalid ? (
            <div>
              <p
                className="font-mono text-3xs text-muted-foreground/70"
                data-testid="agent-eval-case-path"
              >
                {dir}/{evalCase.fileName}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {evalCase.problems.map((problem) => (
                  <li className="text-2xs text-destructive" key={problem.code}>
                    {problem.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              Input
            </p>
            <div className="mt-0.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <Markdown content={evalCase.input} />
            </div>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              Expected output
            </p>
            <div className="mt-0.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <Markdown content={evalCase.expected} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Stable, content-derived key for a feedback entry (it has no id of its own). */
function feedbackKey(entry: FeedbackEntry): string {
  return `${entry.date}|${entry.author}|${entry.status}|${entry.body.slice(0, 64)}`;
}

/**
 * `limit` caps how many entries render, keeping the newest-first order the
 * contract fixes (§3.3). Omitted for the profile section, which shows the
 * whole log; passed as 5 by the dashboard detail view (R2).
 */
export function FeedbackBlock({
  entries,
  limit,
}: {
  entries: FeedbackEntry[];
  limit?: number;
}) {
  if (entries.length === 0) return null;
  const visible = typeof limit === "number" ? entries.slice(0, limit) : entries;
  const capped = typeof limit === "number" && entries.length > limit;

  return (
    <div className="px-4 py-2" data-testid="agent-evals-feedback">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        Feedback log ({visible.length}
        {capped ? ` of ${entries.length}` : ""})
      </p>
      <ul className="mt-1 space-y-1.5">
        {visible.map((entry) => (
          <li
            className="border-l-2 border-border/60 pl-2"
            data-status={entry.status}
            // The log has no ids of its own, and date+author repeat
            // legitimately, so the key folds in the body. Content-derived
            // rather than positional: the log is append-only at the top, so an
            // index key would re-key every entry on each new annotation.
            key={feedbackKey(entry)}
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-2xs text-muted-foreground">
                {entry.date} · {entry.author}
              </span>
              <span
                className={cn(
                  "rounded-sm px-1 py-px text-3xs",
                  STATUS_CLASSES[entry.status] ??
                    "bg-muted text-muted-foreground",
                )}
              >
                {entry.status}
              </span>
              {entry.linkedCase ? (
                <span className="font-mono text-3xs text-muted-foreground/80">
                  → {entry.linkedCase}
                </span>
              ) : null}
            </span>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
              {entry.body}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiscrepanciesBlock({
  discrepancies,
}: {
  discrepancies: string[];
}) {
  if (discrepancies.length === 0) return null;
  return (
    <div className="px-4 py-2" data-testid="agent-evals-discrepancies">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        Mismatches
      </p>
      <ul className="mt-1 space-y-0.5">
        {discrepancies.map((line) => (
          <li className="text-2xs text-destructive" key={line}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
