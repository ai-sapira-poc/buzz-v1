import * as React from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  useCreateSkillMutation,
  useLibrarySkillsQuery,
  useSkillDocumentQuery,
  useUpdateSkillMutation,
} from "../hooks";
import { setSkillsLibraryView } from "../skillsLibraryStore";
import { RestartNotice } from "./RestartNotice";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Guidance for the description field, shown inline rather than in a tooltip.
 *
 * The description is not metadata — it is the whole activation contract (L4),
 * and by §1.1 it lands in every agent's prompt on this machine. A field that
 * important gets its rules stated where it is filled in, including the
 * exclusion clause, which is the part people leave out and the part that stops
 * a skill from hijacking someone else's turn.
 */
function DescriptionHelp() {
  return (
    <div className="mt-1 space-y-1 text-2xs text-muted-foreground">
      <p>
        This is the only thing the model reads when deciding whether to use the
        skill — and every agent on this machine sees it. Write three parts:
      </p>
      <ul className="ml-3 list-disc space-y-0.5">
        <li>
          <span className="font-medium text-foreground">What it does</span> — in
          one clause.
        </li>
        <li>
          <span className="font-medium text-foreground">When to use it</span> —
          concrete triggers, the words someone would actually say.
        </li>
        <li>
          <span className="font-medium text-foreground">
            When <em>not</em> to use it
          </span>{" "}
          — the exclusions. Without these the skill fires on turns that belong
          to other agents.
        </li>
      </ul>
    </div>
  );
}

export function SkillCreateForm() {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const mutation = useCreateSkillMutation();
  const [done, setDone] = React.useState<string | null>(null);

  const nameInvalid = name.length > 0 && !KEBAB.test(name);
  const canSubmit =
    KEBAB.test(name) && description.trim().length > 0 && !mutation.isPending;

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;
      await mutation.mutateAsync({ body, description, name });
      setDone(name);
    },
    [body, canSubmit, description, mutation, name],
  );

  if (done) {
    return (
      <div className="space-y-3 px-4 py-3" data-testid="skills-create-done">
        <p className="text-sm text-foreground">
          <span className="font-medium">{done}</span> is in the library.
        </p>
        <RestartNotice />
        <Button
          data-testid="skills-create-back"
          onClick={() => setSkillsLibraryView({ kind: "list" })}
          size="sm"
        >
          Back to the list
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 px-4 py-3"
      data-testid="skills-create-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div>
        <label
          className="text-2xs uppercase tracking-wide text-muted-foreground"
          htmlFor="skill-create-name"
        >
          Name
        </label>
        <Input
          autoComplete="off"
          className="mt-0.5 font-mono text-xs"
          data-testid="skills-create-name"
          id="skill-create-name"
          onChange={(event) => setName(event.target.value)}
          placeholder="resumir-hilos"
          value={name}
        />
        {nameInvalid ? (
          <p
            className="mt-1 text-2xs text-destructive"
            data-testid="skills-create-name-error"
          >
            Use kebab-case: lowercase letters, digits and single hyphens.
          </p>
        ) : null}
      </div>

      <div>
        <label
          className="text-2xs uppercase tracking-wide text-muted-foreground"
          htmlFor="skill-create-description"
        >
          Activation description
        </label>
        <Textarea
          className="mt-0.5 text-xs"
          data-testid="skills-create-description"
          id="skill-create-description"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Resumir un hilo largo en decisiones y pendientes. Usar cuando pidan el resumen de una conversación. No usar para redactar mensajes nuevos."
          rows={5}
          value={description}
        />
        <DescriptionHelp />
      </div>

      <div>
        <label
          className="text-2xs uppercase tracking-wide text-muted-foreground"
          htmlFor="skill-create-body"
        >
          Body (markdown)
        </label>
        <Textarea
          className="mt-0.5 font-mono text-xs"
          data-testid="skills-create-body"
          id="skill-create-body"
          onChange={(event) => setBody(event.target.value)}
          placeholder={"# Resumir hilos\n\nProcedimiento…"}
          rows={10}
          value={body}
        />
      </div>

      {mutation.isError ? (
        <p
          className="text-xs text-destructive"
          data-testid="skills-create-error"
        >
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not write that skill."}
        </p>
      ) : null}

      <RestartNotice />

      <Button
        data-testid="skills-create-submit"
        disabled={!canSubmit}
        size="sm"
        type="submit"
      >
        {mutation.isPending ? "Writing…" : "Create skill"}
      </Button>
    </form>
  );
}

/**
 * v1 edit: body and description only.
 *
 * Renaming is deliberately out — the name lives in three places at once (the
 * directory, the frontmatter, and every runtime symlink), and getting one of
 * them wrong makes the skill vanish. Deleting is out too.
 */
export function SkillEditForm({ name }: { name: string }) {
  const skillsQuery = useLibrarySkillsQuery();
  const skill = skillsQuery.data?.find((entry) => entry.name === name);
  const documentQuery = useSkillDocumentQuery(skill?.dir ?? null);
  const mutation = useUpdateSkillMutation();

  const [description, setDescription] = React.useState<string | null>(null);
  const [body, setBody] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const currentDescription = description ?? skill?.description ?? "";
  const currentBody = body ?? documentQuery.data?.body ?? "";

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!currentDescription.trim()) return;
      await mutation.mutateAsync({
        body: currentBody,
        description: currentDescription,
        name,
      });
      setSaved(true);
    },
    [currentBody, currentDescription, mutation, name],
  );

  if (!skill) {
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        This skill is no longer in the library.
      </p>
    );
  }

  return (
    <form
      className="space-y-3 px-4 py-3"
      data-testid="skills-edit-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <p className="font-mono text-2xs text-muted-foreground">{skill.dir}</p>

      <div>
        <label
          className="text-2xs uppercase tracking-wide text-muted-foreground"
          htmlFor="skill-edit-description"
        >
          Activation description
        </label>
        <Textarea
          className="mt-0.5 text-xs"
          data-testid="skills-edit-description"
          id="skill-edit-description"
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          value={currentDescription}
        />
        <DescriptionHelp />
      </div>

      <div>
        <label
          className="text-2xs uppercase tracking-wide text-muted-foreground"
          htmlFor="skill-edit-body"
        >
          Body (markdown)
        </label>
        <Textarea
          className="mt-0.5 font-mono text-xs"
          data-testid="skills-edit-body"
          disabled={documentQuery.isPending}
          id="skill-edit-body"
          onChange={(event) => setBody(event.target.value)}
          rows={12}
          value={currentBody}
        />
      </div>

      {mutation.isError ? (
        <p className="text-xs text-destructive" data-testid="skills-edit-error">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not save that skill."}
        </p>
      ) : null}

      {saved ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="skills-edit-saved"
        >
          Saved and committed.
        </p>
      ) : null}

      <RestartNotice />

      <Button
        data-testid="skills-edit-submit"
        disabled={!currentDescription.trim() || mutation.isPending}
        size="sm"
        type="submit"
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
