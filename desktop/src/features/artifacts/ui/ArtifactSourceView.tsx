/**
 * Raw source view for the artifact panel's Source tab, and the fallback surface
 * when the preview cannot be shown.
 *
 * Plain monospace render in a `<pre>`; the browser handles wrapping and
 * scrolling. Syntax highlighting is deliberately out of scope for A1 — the tab
 * exists so a reader can inspect what they are about to trust, and colour does
 * not serve that.
 */
export function ArtifactSourceView({ text }: { text: string }) {
  return (
    <pre
      className="overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-5 text-muted-foreground"
      data-testid="artifact-source"
    >
      {text}
    </pre>
  );
}
