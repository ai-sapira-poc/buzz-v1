import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import { Spinner } from "@/shared/ui/spinner";
import { useRuntimeSkillsQuery } from "../hooks";
import type { DiscoveredSkill, SkillScope } from "../types";
import { SkillMarkdown, SupportingFileList } from "./SkillMarkdown";
import { DescriptionLine, SkillProblems } from "./SkillProblemBadges";

/**
 * Read-only "Skills" section of the agent profile.
 *
 * Shows what **this agent's runtime** would actually discover, under the rules
 * in `crates/buzz-agent/src/hints.rs` and `docs/spec-agent-profile.md` §1.2 —
 * not a generic list. Two distinctions carry the section:
 *
 * - **Scope**: skills that live in the nest (written by Buzz, global to every
 *   managed agent) versus ones that come from `~/.agents/skills` or a runtime's
 *   own directory.
 * - **Shadowing**: a skill whose name an earlier directory already claimed is
 *   discarded by the runtime without a word. Here it is listed and labelled.
 *
 * Nothing in this section writes. Creating, editing and importing all live in
 * the Skills library.
 */

const SCOPE_LABELS: Record<SkillScope, string> = {
  nest: "In this machine's Buzz nest",
  machineGlobal: "Global to this machine",
  runtimeOwned: "This runtime's own directory",
};

const SCOPE_ORDER: SkillScope[] = ["nest", "machineGlobal", "runtimeOwned"];

export function AgentSkillsSection({
  runtimeId,
}: {
  runtimeId: string | null | undefined;
}) {
  const query = useRuntimeSkillsQuery(runtimeId);

  if (!runtimeId) return null;

  if (query.isPending) {
    return (
      <PanelSectionGroup testId="agent-skills-section" title="Skills">
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          Reading skill directories…
        </div>
      </PanelSectionGroup>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : "Could not read the skill directories.";
    return (
      <PanelSectionGroup testId="agent-skills-section" title="Skills">
        <p className="px-4 py-3 text-sm text-muted-foreground">{message}</p>
      </PanelSectionGroup>
    );
  }

  const { skills, scanned, cwd } = query.data;
  const grouped = SCOPE_ORDER.map((scope) => ({
    scope,
    skills: skills.filter((skill) => skill.scope === scope),
  })).filter((group) => group.skills.length > 0);

  return (
    <PanelSectionGroup
      description={
        <span className="font-mono text-2xs text-muted-foreground">{cwd}</span>
      }
      testId="agent-skills-section"
      title="Skills"
    >
      {skills.length === 0 ? (
        <div className="px-4 py-3" data-testid="agent-skills-empty">
          <p className="text-sm text-muted-foreground">
            This runtime finds no skills. Scanned, in order:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {scanned.map((dir) => (
              <li
                className="font-mono text-2xs text-muted-foreground/80"
                key={dir.path}
              >
                {dir.label}
                {dir.exists ? "" : " (missing)"}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="divide-y divide-border/55">
          {grouped.map((group) => (
            <div className="px-4 py-2" key={group.scope}>
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                {SCOPE_LABELS[group.scope]}
              </p>
              <div className="mt-1 space-y-1">
                {group.skills.map((skill) => (
                  <SkillRow
                    key={`${skill.sourceDir}:${skill.dir}`}
                    skill={skill}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelSectionGroup>
  );
}

function SkillRow({ skill }: { skill: DiscoveredSkill }) {
  const [open, setOpen] = React.useState(false);
  const inert = skill.shadowed || !skill.discoverable;

  return (
    <div data-skill={skill.name} data-testid="agent-skill-row">
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
            <span
              className={cn(
                "font-medium text-sm",
                inert
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
            >
              {skill.name}
            </span>
            <span className="font-mono text-3xs text-muted-foreground/70">
              {skill.sourceDir}
            </span>
            {skill.shadowed ? (
              <span
                className="rounded-sm bg-destructive/10 px-1 py-px text-3xs text-destructive"
                data-testid="agent-skill-shadowed"
              >
                shadowed by {skill.shadowedBy}
              </span>
            ) : null}
            {!skill.discoverable ? (
              <span
                className="rounded-sm bg-destructive/10 px-1 py-px text-3xs text-destructive"
                data-testid="agent-skill-undiscoverable"
              >
                not discovered
              </span>
            ) : null}
          </span>
          <DescriptionLine
            description={skill.description}
            verdict={skill.descriptionVerdict}
          />
        </span>
      </button>

      {open ? (
        <div className="mb-2 ml-5 mt-1 space-y-2">
          {skill.shadowed ? (
            <p className="text-2xs text-destructive">
              A skill with this name was already found in{" "}
              <span className="font-mono">{skill.shadowedBy}</span>, so the
              runtime discards this copy without a word. Rename one of them.
            </p>
          ) : null}
          <SkillProblems problems={skill.problems} />
          <SkillMarkdown dir={skill.dir} testId="agent-skill-body" />
          <SupportingFileList files={skill.supportingFiles} />
        </div>
      ) : null}
    </div>
  );
}
