import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { splitAgentsByRestartNeed } from "../hooks";

/**
 * Who sees a skill that was just written, and who needs restarting first.
 *
 * L1: `build_hints_section` runs once, inside `session_new`
 * (`crates/buzz-agent/src/lib.rs:442`), so a live session's skill list is fixed
 * at creation. Writing a skill changes nothing for an agent that is already
 * running.
 *
 * Saying this out loud is the difference between a feature that works and one
 * that looks broken: without it, the user imports a skill, watches a running
 * agent ignore it, and concludes the import failed.
 */
export function RestartNotice({ testId }: { testId?: string }) {
  const agentsQuery = useManagedAgentsQuery();
  const { willSee, needsRestart } = splitAgentsByRestartNeed(agentsQuery.data);

  if (willSee.length === 0 && needsRestart.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
      data-testid={testId ?? "skills-restart-notice"}
    >
      {needsRestart.length > 0 ? (
        <p className="text-xs text-foreground">
          <span className="font-medium">Needs a restart:</span>{" "}
          <span data-testid="skills-restart-needed">
            {needsRestart.join(", ")}
          </span>
          <span className="text-muted-foreground">
            {" "}
            — a running agent fixed its skill list when its session opened.
          </span>
        </p>
      ) : null}
      {willSee.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Will pick it up:</span>{" "}
          <span data-testid="skills-restart-will-see">
            {willSee.join(", ")}
          </span>
        </p>
      ) : null}
    </div>
  );
}
