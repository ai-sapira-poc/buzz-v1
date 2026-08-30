import { Markdown } from "@/shared/ui/markdown";
import { Skeleton } from "@/shared/ui/skeleton";
import { useSkillDocumentQuery } from "../hooks";

/**
 * The rendered body of a `SKILL.md`, fetched on open.
 *
 * Lazy on purpose, mirroring the runtime: the body never reaches an agent's
 * prompt until it calls `load_skill`, and it does not need to reach this panel
 * until a reader asks for it.
 */
export function SkillMarkdown({
  dir,
  testId,
}: {
  dir: string;
  testId?: string;
}) {
  const query = useSkillDocumentQuery(dir);

  if (query.isPending) {
    return (
      <div className="space-y-2" data-testid={testId && `${testId}-loading`}>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : "Could not read this SKILL.md.";
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid={testId && `${testId}-error`}
      >
        {message}
      </p>
    );
  }

  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
      data-testid={testId}
    >
      <Markdown content={query.data.body} />
    </div>
  );
}

/** Files that ship alongside a `SKILL.md`. */
export function SupportingFileList({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-2" data-testid="skill-supporting-files">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">
        Supporting files ({files.length})
      </p>
      <ul className="mt-1 space-y-0.5">
        {files.map((file) => (
          <li className="font-mono text-2xs text-muted-foreground" key={file}>
            {file}
          </li>
        ))}
      </ul>
    </div>
  );
}
