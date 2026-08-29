import * as React from "react";
import { AlertTriangle, FolderInput } from "lucide-react";

import { invokeTauri } from "@/shared/api/tauri";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Spinner } from "@/shared/ui/spinner";
import { Textarea } from "@/shared/ui/textarea";
import {
  useConfirmSkillImportMutation,
  usePreviewSkillImportMutation,
} from "../hooks";
import { setSkillsLibraryView } from "../skillsLibraryStore";
import type { ImportCandidate, ImportPreview, ImportResult } from "../types";
import { RestartNotice } from "./RestartNotice";

/**
 * Import skills that already exist elsewhere — the library's main path.
 *
 * The preview is not a formality. Two things go wrong silently after a write
 * and are cheap to catch before one:
 *
 * - **A name collision** removes a skill from every agent's prompt, because the
 *   first directory to claim a name wins (`hints.rs:136`). So a collision
 *   blocks, and the fix is a rename — never an overwrite.
 * - **A missing or vague description** is the only thing the model reads when
 *   deciding (L4), and by §1.1 that line is in *every* agent's prompt. So it is
 *   editable right here, in the row, before it becomes a problem.
 */
export function SkillImportFlow() {
  const [source, setSource] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [edits, setEdits] = React.useState<
    Record<string, { name: string; description: string }>
  >({});
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [pickError, setPickError] = React.useState<string | null>(null);

  const previewMutation = usePreviewSkillImportMutation();
  const confirmMutation = useConfirmSkillImportMutation();

  const runPreview = React.useCallback(
    async (dir: string) => {
      setSource(dir);
      setResult(null);
      const next = await previewMutation.mutateAsync(dir);
      setPreview(next);
      setEdits(
        Object.fromEntries(
          next.candidates.map((candidate) => [
            candidate.source,
            // Pre-filled with the name as found, never with the suggestion.
            // Auto-applying a rename would resolve the collision without the
            // user seeing it, and they would end up with a skill under a name
            // they never chose — a quieter version of the overwrite this flow
            // exists to prevent. The suggestion is offered as a button instead.
            { name: candidate.name, description: candidate.description },
          ]),
        ),
      );
    },
    [previewMutation],
  );

  const handlePick = React.useCallback(async () => {
    setPickError(null);
    try {
      const picked = await invokeTauri<string | null>("pick_skill_import_dir");
      if (!picked) return;
      await runPreview(picked);
    } catch (error) {
      setPickError(
        error instanceof Error ? error.message : "Could not open that folder.",
      );
    }
  }, [runPreview]);

  const handleConfirm = React.useCallback(async () => {
    if (!source || !preview) return;
    const items = preview.candidates
      .map((candidate) => ({
        candidate,
        edit: edits[candidate.source],
      }))
      .filter(({ candidate, edit }) => isImportable(candidate, edit))
      .map(({ candidate, edit }) => ({
        source: candidate.source,
        name: edit?.name ?? candidate.name,
        description: edit?.description ?? candidate.description,
      }));
    if (items.length === 0) return;
    const outcome = await confirmMutation.mutateAsync({ source, items });
    setResult(outcome);
  }, [confirmMutation, edits, preview, source]);

  if (result) {
    return (
      <ImportSummary
        onDone={() => setSkillsLibraryView({ kind: "list" })}
        result={result}
      />
    );
  }

  const readyCount =
    preview?.candidates.filter((candidate) =>
      isImportable(candidate, edits[candidate.source]),
    ).length ?? 0;

  return (
    <div className="space-y-3 px-4 py-3" data-testid="skills-import">
      <p className="text-sm text-muted-foreground">
        Pick a skills directory (like <code>~/.claude/skills</code>) or a single
        skill folder. Nothing is written until you confirm.
      </p>

      <Button
        data-testid="skills-import-pick"
        onClick={() => void handlePick()}
        size="sm"
        variant="secondary"
      >
        <FolderInput className="mr-1 h-3.5 w-3.5" />
        Choose a folder
      </Button>

      {pickError ? (
        <p
          className="text-xs text-destructive"
          data-testid="skills-import-pick-error"
        >
          {pickError}
        </p>
      ) : null}

      {source ? (
        <p className="font-mono text-2xs text-muted-foreground">{source}</p>
      ) : null}

      {previewMutation.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" />
          Reading that folder…
        </div>
      ) : null}

      {previewMutation.isError ? (
        <p
          className="text-sm text-destructive"
          data-testid="skills-import-error"
        >
          {previewMutation.error instanceof Error
            ? previewMutation.error.message
            : "Could not read that folder."}
        </p>
      ) : null}

      {preview ? (
        <>
          {preview.truncated ? (
            <p className="text-xs text-destructive">{preview.truncated}</p>
          ) : null}

          {preview.candidates.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="skills-import-none"
            >
              No skills there — a skill is a folder with a SKILL.md in it.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="skills-import-candidates">
              {preview.candidates.map((candidate) => (
                <CandidateRow
                  candidate={candidate}
                  edit={edits[candidate.source]}
                  key={candidate.source}
                  onChange={(next) =>
                    setEdits((current) => ({
                      ...current,
                      [candidate.source]: next,
                    }))
                  }
                />
              ))}
            </ul>
          )}

          <RestartNotice />

          <div className="flex items-center gap-2">
            <Button
              data-testid="skills-import-confirm"
              disabled={readyCount === 0 || confirmMutation.isPending}
              onClick={() => void handleConfirm()}
              size="sm"
            >
              {confirmMutation.isPending
                ? "Importing…"
                : `Import ${readyCount} skill${readyCount === 1 ? "" : "s"}`}
            </Button>
            {readyCount < preview.candidates.length ? (
              <span className="text-2xs text-muted-foreground">
                {preview.candidates.length - readyCount} still need attention.
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A candidate is importable once its name is free and valid and it has a
 * description. The generic-description verdict warns but does not block: the
 * heuristic errs toward flagging, so it must not be able to stop a legitimate
 * import.
 */
function isImportable(
  candidate: ImportCandidate,
  edit: { name: string; description: string } | undefined,
): boolean {
  const name = edit?.name ?? candidate.name;
  const description = edit?.description ?? candidate.description;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return false;
  if (!description.trim()) return false;
  // A collision is only cleared by actually changing the name.
  if (
    (candidate.collidesWithExisting || candidate.collidesWithinBatch) &&
    name === candidate.name
  ) {
    return false;
  }
  return true;
}

function CandidateRow({
  candidate,
  edit,
  onChange,
}: {
  candidate: ImportCandidate;
  edit: { name: string; description: string } | undefined;
  onChange: (next: { name: string; description: string }) => void;
}) {
  const name = edit?.name ?? candidate.name;
  const description = edit?.description ?? candidate.description;
  const nameInvalid = !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
  const collides =
    (candidate.collidesWithExisting || candidate.collidesWithinBatch) &&
    name === candidate.name;
  const descriptionMissing = !description.trim();
  const ready = isImportable(candidate, edit);

  return (
    <li
      className="rounded-lg border border-border/60 px-3 py-2"
      data-ready={ready}
      data-skill={candidate.name}
      data-testid="skills-import-candidate"
    >
      <div className="space-y-1.5">
        <div>
          <label
            className="text-2xs uppercase tracking-wide text-muted-foreground"
            htmlFor={`import-name-${candidate.name}`}
          >
            Name
          </label>
          <Input
            className="mt-0.5 font-mono text-xs"
            data-testid="skills-import-name"
            id={`import-name-${candidate.name}`}
            onChange={(event) =>
              onChange({ description, name: event.target.value })
            }
            value={name}
          />
          {collides ? (
            <p
              className="mt-1 flex items-start gap-1 text-2xs text-destructive"
              data-testid="skills-import-collision"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                A skill called <code>{candidate.name}</code> already exists.
                Rename this one — importing over it would remove the existing
                skill from every agent's prompt.
              </span>
            </p>
          ) : null}
          {nameInvalid ? (
            <p className="mt-1 text-2xs text-destructive">
              {candidate.nameError ??
                "Use kebab-case: lowercase letters, digits and single hyphens."}
            </p>
          ) : null}
          {(collides || nameInvalid) && candidate.suggestedName ? (
            <Button
              className="mt-1 h-6 px-2 text-2xs"
              data-testid="skills-import-use-suggestion"
              onClick={() =>
                onChange({
                  description,
                  name: candidate.suggestedName as string,
                })
              }
              size="sm"
              type="button"
              variant="secondary"
            >
              Use {candidate.suggestedName}
            </Button>
          ) : null}
        </div>

        <div>
          <label
            className="text-2xs uppercase tracking-wide text-muted-foreground"
            htmlFor={`import-description-${candidate.name}`}
          >
            Activation description
          </label>
          <Textarea
            className="mt-0.5 text-xs"
            data-testid="skills-import-description"
            id={`import-description-${candidate.name}`}
            onChange={(event) =>
              onChange({ description: event.target.value, name })
            }
            rows={3}
            value={description}
          />
          {descriptionMissing ? (
            <p
              className="mt-1 flex items-start gap-1 text-2xs text-destructive"
              data-testid="skills-import-no-description"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {candidate.descriptionHint ??
                  "Without a description the model never sees this skill."}
              </span>
            </p>
          ) : candidate.descriptionHint &&
            description === candidate.description ? (
            <p
              className="mt-1 text-2xs text-destructive/80"
              data-testid="skills-import-generic-description"
            >
              {candidate.descriptionHint}
            </p>
          ) : null}
        </div>

        {candidate.supportingFiles.length > 0 ? (
          <p className="text-2xs text-muted-foreground">
            {candidate.supportingFiles.length} supporting file
            {candidate.supportingFiles.length === 1 ? "" : "s"}:{" "}
            <span className="font-mono">
              {candidate.supportingFiles.slice(0, 4).join(", ")}
              {candidate.supportingFiles.length > 4 ? "…" : ""}
            </span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ImportSummary({
  onDone,
  result,
}: {
  onDone: () => void;
  result: ImportResult;
}) {
  return (
    <div className="space-y-3 px-4 py-3" data-testid="skills-import-summary">
      {result.outcomes.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-foreground">
            Imported {result.outcomes.length} skill
            {result.outcomes.length === 1 ? "" : "s"}.
          </p>
          <ul className="mt-1 space-y-1">
            {result.outcomes.map((outcome) => (
              <li
                className="text-xs text-muted-foreground"
                data-skill={outcome.name}
                data-testid="skills-import-outcome"
                key={outcome.name}
              >
                <span className="font-medium text-foreground">
                  {outcome.name}
                </span>
                {outcome.commit ? (
                  <span className="font-mono"> · {outcome.commit}</span>
                ) : (
                  <span className="text-destructive"> · not committed</span>
                )}
                {outcome.warnings.map((warning) => (
                  <span className="block text-destructive" key={warning}>
                    {warning}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.failures.length > 0 ? (
        <div data-testid="skills-import-failures">
          <p className="text-sm font-medium text-destructive">
            Not imported ({result.failures.length})
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.failures.map((failure) => (
              <li className="text-xs text-destructive" key={failure}>
                {failure}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RestartNotice />

      <Button data-testid="skills-import-done" onClick={onDone} size="sm">
        Done
      </Button>
    </div>
  );
}
