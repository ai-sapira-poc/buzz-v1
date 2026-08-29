import type { ArtifactKind } from "@/shared/lib/artifactKind";

/**
 * Build the document handed to the preview frame, and report what the current
 * renderer cannot honour.
 *
 * Pure and I/O-free: this is the seam where artifact bytes become frame content,
 * so it is worth unit-testing away from React.
 *
 * Milestone A1 renders through `srcdoc`, which inherits the app's CSP. Inline
 * styles survive (`style-src` carries `'unsafe-inline'`) but inline scripts do
 * not (`script-src 'self'`), so an artifact's JavaScript silently does nothing.
 * `sourceHasScript` exists to turn that silence into a visible notice — the
 * failure mode `docs/spike-csp-results.md` warns about. A2 removes the
 * limitation by serving the artifact over the `artifact://` protocol.
 */

/** HTML artifacts pass through untouched; SVG needs a host document. */
export function buildArtifactSrcDoc(kind: ArtifactKind, text: string): string {
  if (kind === "html") return text;

  // The SVG markup is inlined into an HTML document rather than handed over as
  // an SVG document, because `srcdoc` is always parsed as HTML. The wrapper only
  // centres and bounds the image; it sets no colours, so the artifact keeps its
  // own appearance.
  return [
    "<!doctype html>",
    '<meta charset="utf-8">',
    "<style>",
    "html,body{margin:0;height:100%}",
    "body{display:flex;align-items:center;justify-content:center}",
    "svg{max-width:100%;max-height:100%;height:auto}",
    "</style>",
    text,
  ].join("");
}

/**
 * Whether the source carries a `<script>` element, so the panel can tell the
 * reader that scripts are not executed in this preview.
 *
 * Deliberately a coarse tag scan. It is a UI hint, never a security control —
 * the trust boundary is the frame `sandbox` plus the inherited CSP, and a false
 * negative here costs a notice, not containment.
 */
export function sourceHasScript(text: string): boolean {
  return /<script[\s>]/i.test(text);
}
