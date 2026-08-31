import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import { Spinner } from "@/shared/ui/spinner";
import { useAgentEvalsQuery } from "../hooks";
import {
  BulletinBlock,
  CasesBlock,
  DiscrepanciesBlock,
  FeedbackBlock,
} from "./EvalBlocks";

/**
 * Read-only "Evals" section of the agent profile.
 *
 * Renders the contract in `docs/spec-agent-profile.md` §3: the cases with their
 * origin, the latest bulletin, and the feedback log. The origin distinction is
 * the point of the section — a case written at the agent's birth is a
 * specification, a case derived from feedback is a regression someone actually
 * hit — so it is shown on every row rather than buried in a detail view.
 *
 * The blocks themselves live in `EvalBlocks.tsx`, shared with the eval
 * dashboard's per-agent detail view (I3) so both surfaces render the same
 * contract the same way instead of drifting apart.
 *
 * Nothing here writes.
 */

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
        <CasesBlock cases={evals.cases} dir={evals.dir} />
        <FeedbackBlock entries={evals.feedback} />
        <DiscrepanciesBlock discrepancies={evals.discrepancies} />
      </div>
    </PanelSectionGroup>
  );
}
