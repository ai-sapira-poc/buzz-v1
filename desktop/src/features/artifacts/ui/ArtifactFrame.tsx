import type { ArtifactKind } from "@/shared/lib/artifactKind";
import { buildArtifactSrcDoc } from "../artifactDocument";

/**
 * SECURITY — the entire trust boundary is the `sandbox` attribute below.
 *
 * `allow-scripts` is present so this constant does not have to change when
 * Milestone A2 swaps `srcDoc` for the `artifact://` protocol. The deliberate
 * ABSENCE of `allow-same-origin` forces the frame to an opaque (`null`) origin,
 * so its content CANNOT read the parent's storage, cookies, relay session, or
 * NIP-98 auth — even though it renders on the same document origin.
 *
 * **Do not add `allow-same-origin`**: that would hand attacker-supplied markup
 * the user's session. This is asserted by test, not left to review.
 *
 * In A1 the frame is inert for a second, independent reason: a `srcdoc`
 * document inherits the embedder's CSP, and the app's `script-src 'self'` has no
 * `'unsafe-inline'`, so the artifact's own scripts never execute. Verified on
 * WKWebView — see `docs/spike-csp-results.md` §3. Inline *styles* do run, so
 * artifacts keep their appearance.
 */
export const ARTIFACT_SANDBOX = "allow-scripts";

export function ArtifactFrame({
  kind,
  text,
  title,
}: {
  kind: ArtifactKind;
  text: string;
  title: string;
}) {
  return (
    <iframe
      className="h-[calc(100vh-14rem)] w-full rounded-lg border border-border/60 bg-white"
      data-testid="artifact-frame"
      referrerPolicy="no-referrer"
      sandbox={ARTIFACT_SANDBOX}
      srcDoc={buildArtifactSrcDoc(kind, text)}
      title={title}
    />
  );
}
