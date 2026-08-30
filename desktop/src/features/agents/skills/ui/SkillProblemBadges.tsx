import { AlertTriangle, EyeOff } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import type { DescriptionVerdict, SkillProblem } from "../types";

/**
 * The two failures that make a skill useless, shown rather than hidden.
 *
 * The runtime discards a nameless skill and a bad description in silence
 * (`hints.rs:105`, and L4). A reading surface that copied that silence would be
 * useless: the whole point is to answer "why isn't my skill firing?".
 */
export function SkillProblems({
  problems,
  testId,
}: {
  problems: SkillProblem[];
  testId?: string;
}) {
  if (problems.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1" data-testid={testId}>
      {problems.map((problem) => (
        <li
          className={cn(
            "flex items-start gap-1.5 text-2xs",
            isFatal(problem.code)
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          data-problem={problem.code}
          key={problem.code}
        >
          {isFatal(problem.code) ? (
            <EyeOff className="mt-0.5 h-3 w-3 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          )}
          <span>{problem.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** A problem that makes the skill invisible, not merely imprecise. */
function isFatal(code: string): boolean {
  return code === "missingName" || code === "missingDescription";
}

/** The activation description, coloured by how usable it is. */
export function DescriptionLine({
  description,
  verdict,
  testId,
}: {
  description: string;
  verdict: DescriptionVerdict;
  testId?: string;
}) {
  if (verdict === "missing") {
    return (
      <p className="text-xs text-destructive" data-testid={testId}>
        No activation description — the model never sees this skill.
      </p>
    );
  }
  return (
    <p
      className={cn(
        "text-xs",
        verdict === "generic" ? "text-destructive/80" : "text-muted-foreground",
      )}
      data-testid={testId}
      data-verdict={verdict}
    >
      {description}
    </p>
  );
}
