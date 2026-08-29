/**
 * Classify a message attachment as a previewable artifact.
 *
 * Pure and I/O-free so the riskiest half of the preview decision is unit-testable
 * without mounting React. Lives in `shared/lib` (not `features/artifacts`) so
 * `shared/ui/markdownFileCard.ts` can call it without inverting the layering.
 *
 * **SVG is classified by filename, never by MIME.** `infer` has no SVG matcher —
 * see the `test_validate_svg_rejected` comment in
 * `crates/buzz-media/src/validation.rs` — so an uploaded `.svg` sniffs as
 * `application/octet-stream` and is stored with that MIME. A MIME-based SVG check
 * would therefore never match a real attachment. `docs/plan-artifact-preview.md`
 * §4.3 records the consequence: if `infer` ever gains an SVG matcher, uploads and
 * downloads start failing closed and this classifier silently loses SVG support.
 */
export type ArtifactKind = "html" | "svg";

export type ArtifactKindInput = {
  /** Resolved display filename (imeta `filename`, link text, or URL basename). */
  filename?: string;
  /** imeta `m` field, if present. May carry parameters (`text/html; charset=…`). */
  mime?: string;
};

/** Strip MIME parameters and normalize case: `Text/HTML; charset=utf-8` → `text/html`. */
function normalizeMime(mime: string | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Normalize a filename to its lowercased trailing segment, without query or
 * fragment. Attachment filenames usually arrive clean, but the caller may have
 * derived one from a URL basename, so `page.html?v=2` must not defeat the check.
 */
function normalizeFilename(filename: string | undefined): string {
  const trimmed = (filename ?? "").trim();
  if (!trimmed) return "";
  const segment = trimmed.split(/[/\\]/).pop() ?? "";
  return segment.split(/[?#]/)[0].toLowerCase();
}

/**
 * Decide whether an attachment can be previewed, and how to render it.
 *
 * Returns `null` to fall through to the plain download card.
 */
export function resolveArtifactKind(
  input: ArtifactKindInput | undefined,
): ArtifactKind | null {
  if (!input) return null;

  const filename = normalizeFilename(input.filename);
  const mime = normalizeMime(input.mime);

  // Extension wins: it is the only reliable SVG signal (see the module doc), and
  // for HTML it agrees with the MIME whenever both are present.
  if (filename.endsWith(".svg")) return "svg";
  if (filename.endsWith(".html") || filename.endsWith(".htm")) return "html";

  // `image/svg+xml` is accepted for completeness. In practice the caller filters
  // `image/*` to the img renderer before reaching here, so this arm is unreachable
  // through `resolveFileCard` today.
  if (mime === "image/svg+xml") return "svg";
  if (mime === "text/html") return "html";

  return null;
}
