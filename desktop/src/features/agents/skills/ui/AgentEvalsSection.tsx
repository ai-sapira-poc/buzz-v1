import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Markdown } from "@/shared/ui/markdown";
import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import { Spinner } from "@/shared/ui/spinner";
import { useAgentEvalsQuery } from "../hooks";
import type { AgentEvals, EvalCase, FeedbackEntry } from "../types";

/**
 * Read-only "Evals" section of the agent profile.
 *
 * Renders the contract in `docs/spec-agent-profile.md` §3: the cases with their
 * origin, the latest bulletin, and the feedback log. The origin distinction is
 * the point of the section — a case written at the agent's birth is a
 * specification, a case derived from feedback is a regression someone actually
 * hit — so it is shown on every row rather than buried in a detail view.
 *
 * Nothing here writes.
 */

const ORIGIN_LABELS: Record<string, string> = {
  nacimiento: "at birth",
  feedback: "from feedback",
};

const STATUS_CLASSES: Record<string, string> = {
  abierto: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  corregido: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  descartado: "bg-muted text-muted-foreground",
};

export function AgentEvalsSection({
  agentName,
  pubkey,
}: {
  agentName: string | null | undefined;
  pubkey?: string;
}) {
  const query = useAgentEvalsQuery(agentName, pubkey);

  if (!agentName) return null;

  if (query.isPending) {
    return (
      <PanelSectionGroup testId="agent-evals-section" title="Evals">
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          Reading evals…
        </div>
      </PanelSectionGroup>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : "Could not read this agent's evals.";
    return (
      <PanelSectionGroup testId="agent-evals-section" title="Evals">
        <p className="px-4 py-3 text-sm text-muted-foreground">{message}</p>
      </PanelSectionGroup>
    );
  }

  const evals = query.data;

  if (!evals.exists) {
    return (
      <PanelSectionGroup testId="agent-evals-section" title="Evals">
        <div className="px-4 py-3" data-testid="agent-evals-empty">
          <p className="text-sm text-muted-foreground">
            No evals yet for this agent.
          </p>
          <p className="mt-1 font-mono text-2xs text-muted-foreground/80">
            {evals.dir}
          </p>
        </div>
      </PanelSectionGroup>
    );
  }

  return (
    <PanelSectionGroup testId="agent-evals-section" title="Evals">
      <div className="divide-y divide-border/55">
        <BulletinBlock evals={evals} />
        <CasesBlock cases={evals.cases} />
        <FeedbackBlock entries={evals.feedback} />
        {evals.discrepancies.length > 0 ? (
          <div className="px-4 py-2" data-testid="agent-evals-discrepancies">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              Mismatches
            </p>
            <ul className="mt-1 space-y-0.5">
              {evals.discrepancies.map((line) => (
                <li className="text-2xs text-destructive" key={line}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </PanelSectionGroup>
  );
}

function BulletinBlock({ evals }: { evals: AgentEvals }) {
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
    </div>
  );
}

function CasesBlock({ cases }: { cases: EvalCase[] }) {
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
          <CaseRow evalCase={evalCase} key={evalCase.fileName} />
        ))}
      </div>
    </div>
  );
}

function CaseRow({ evalCase }: { evalCase: EvalCase }) {
  const [open, setOpen] = React.useState(false);
  const id = `caso-${String(evalCase.number).padStart(2, "0")}`;

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
          </span>
          <span className="text-2xs text-muted-foreground/80">
            {evalCase.date} · {evalCase.author}
          </span>
        </span>
      </button>

      {open ? (
        <div className="mb-2 ml-5 mt-1 space-y-2">
          {evalCase.problems.length > 0 ? (
            <ul className="space-y-0.5">
              {evalCase.problems.map((problem) => (
                <li className="text-2xs text-destructive" key={problem.code}>
                  {problem.message}
                </li>
              ))}
            </ul>
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

function FeedbackBlock({ entries }: { entries: FeedbackEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="px-4 py-2" data-testid="agent-evals-feedback">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        Feedback log ({entries.length})
      </p>
      <ul className="mt-1 space-y-1.5">
        {entries.map((entry) => (
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
