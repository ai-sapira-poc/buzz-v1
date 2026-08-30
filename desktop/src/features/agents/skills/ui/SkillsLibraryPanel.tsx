import * as React from "react";
import { ArrowLeft, FolderInput, Plus, Search } from "lucide-react";

import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderActions,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelTitle,
} from "@/shared/layout/AuxiliaryPanel";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Spinner } from "@/shared/ui/spinner";
import { useLibrarySkillsQuery } from "../hooks";
import {
  closeSkillsLibrary,
  setSkillsLibraryQuery,
  setSkillsLibraryView,
  useSkillsLibraryPanel,
} from "../skillsLibraryStore";
import type { LibrarySkill } from "../types";
import { SkillMarkdown, SupportingFileList } from "./SkillMarkdown";
import { DescriptionLine, SkillProblems } from "./SkillProblemBadges";
import { SkillCreateForm, SkillEditForm } from "./SkillCreateForm";
import { SkillImportFlow } from "./SkillImportFlow";

/**
 * The Skills library: a docked, resizable right-hand pane, not a modal.
 *
 * A modal would be wrong for the job. Importing means comparing what is on disk
 * with what is already in the library, skill by skill, and a modal blocks the
 * page behind it. This reuses the `AuxiliaryPanel` shell the artifact viewer
 * and thread panel use, so it docks, resizes, and behaves like every other
 * side pane in the app.
 */
export function SkillsLibraryPanel({
  canResetWidth,
  onResetWidth,
  onResizeStart,
  widthPx,
}: {
  canResetWidth?: boolean;
  onResetWidth?: () => void;
  onResizeStart?: React.PointerEventHandler<HTMLButtonElement>;
  widthPx: number;
}) {
  const { view } = useSkillsLibraryPanel();

  const title =
    view.kind === "import"
      ? "Import skills"
      : view.kind === "create"
        ? "New skill"
        : view.kind === "edit"
          ? view.name
          : view.kind === "detail"
            ? view.name
            : "Skills library";

  const showBack = view.kind !== "list";

  return (
    <AuxiliaryPanel
      canResetWidth={canResetWidth}
      header={
        <AuxiliaryPanelHeader>
          <AuxiliaryPanelHeaderGroup>
            {showBack ? (
              <Button
                aria-label="Back to the skills list"
                className="h-7 w-7"
                data-testid="skills-library-back"
                onClick={() => setSkillsLibraryView({ kind: "list" })}
                size="icon"
                variant="ghost"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <AuxiliaryPanelTitle>{title}</AuxiliaryPanelTitle>
          </AuxiliaryPanelHeaderGroup>
          {view.kind === "list" ? (
            <AuxiliaryPanelHeaderActions>
              <Button
                data-testid="skills-library-import"
                onClick={() => setSkillsLibraryView({ kind: "import" })}
                size="sm"
                variant="secondary"
              >
                <FolderInput className="mr-1 h-3.5 w-3.5" />
                Import
              </Button>
              <Button
                data-testid="skills-library-new"
                onClick={() => setSkillsLibraryView({ kind: "create" })}
                size="sm"
                variant="ghost"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                New
              </Button>
            </AuxiliaryPanelHeaderActions>
          ) : null}
        </AuxiliaryPanelHeader>
      }
      onClose={closeSkillsLibrary}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      resizeHandleAriaLabel="Resize the skills library"
      resizeHandleTestId="skills-library-resize"
      testId="skills-library-panel"
      widthPx={widthPx}
    >
      <AuxiliaryPanelBody>
        {view.kind === "list" ? <SkillsList /> : null}
        {view.kind === "detail" ? <SkillDetail name={view.name} /> : null}
        {view.kind === "import" ? <SkillImportFlow /> : null}
        {view.kind === "create" ? <SkillCreateForm /> : null}
        {view.kind === "edit" ? <SkillEditForm name={view.name} /> : null}
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}

function SkillsList() {
  const { query } = useSkillsLibraryPanel();
  const skillsQuery = useLibrarySkillsQuery();

  const filtered = React.useMemo(() => {
    const skills = skillsQuery.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle),
    );
  }, [query, skillsQuery.data]);

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search skills"
          className="pl-7"
          data-testid="skills-library-search"
          onChange={(event) => setSkillsLibraryQuery(event.target.value)}
          placeholder="Search skills"
          value={query}
        />
      </div>

      {skillsQuery.isPending ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          Reading the skills directory…
        </div>
      ) : skillsQuery.isError ? (
        <p className="py-4 text-sm text-muted-foreground">
          {skillsQuery.error instanceof Error
            ? skillsQuery.error.message
            : "Could not read the skills directory."}
        </p>
      ) : filtered.length === 0 ? (
        <p
          className="py-4 text-sm text-muted-foreground"
          data-testid="skills-library-empty"
        >
          {query.trim()
            ? "No skill matches that search."
            : "No skills yet. Import the ones you already have, or write a new one."}
        </p>
      ) : (
        <ul className="space-y-1" data-testid="skills-library-list">
          {filtered.map((skill) => (
            <li key={skill.name}>
              <button
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/40"
                data-skill={skill.name}
                data-testid="skills-library-row"
                onClick={() =>
                  setSkillsLibraryView({ kind: "detail", name: skill.name })
                }
                type="button"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-sm text-foreground">
                    {skill.name}
                  </span>
                  {!skill.discoverable ? (
                    <span className="rounded-sm bg-destructive/10 px-1 py-px text-3xs text-destructive">
                      not discovered
                    </span>
                  ) : null}
                </span>
                <DescriptionLine
                  description={skill.description}
                  verdict={skill.descriptionVerdict}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillDetail({ name }: { name: string }) {
  const skillsQuery = useLibrarySkillsQuery();
  const skill = skillsQuery.data?.find((entry) => entry.name === name);

  if (!skill) {
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        This skill is no longer in the library.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3" data-testid="skills-library-detail">
      <div>
        <DescriptionLine
          description={skill.description}
          verdict={skill.descriptionVerdict}
        />
        <SkillProblems problems={skill.problems} />
      </div>

      <VisibilityBlock skill={skill} />

      <div className="flex gap-2">
        <Button
          data-testid="skills-library-edit"
          onClick={() => setSkillsLibraryView({ kind: "edit", name })}
          size="sm"
          variant="secondary"
        >
          Edit
        </Button>
      </div>

      <SkillMarkdown dir={skill.dir} testId="skills-library-body" />
      <SupportingFileList files={skill.supportingFiles} />

      <p className="font-mono text-3xs text-muted-foreground/70">{skill.dir}</p>
    </div>
  );
}

/**
 * Which runtimes reach this skill.
 *
 * Worth its own block because the answer is "all of them" and that surprises
 * people: the canonical directory is the agents' shared `cwd`, so one skill is
 * global to every managed agent on the machine (§1.1). Missing runtime links
 * are reported because they are the one way that stops being true.
 */
function VisibilityBlock({ skill }: { skill: LibrarySkill }) {
  return (
    <div data-testid="skills-library-visibility">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        Seen by
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {skill.visibleTo.join(", ")} — every managed agent on this machine
        shares the nest, so this skill is global to all of them.
      </p>
      {!skill.linksComplete ? (
        <p
          className="mt-1 text-2xs text-destructive"
          data-testid="skills-library-missing-links"
        >
          Missing runtime links: {skill.missingLinks.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
