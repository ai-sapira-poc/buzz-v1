import * as React from "react";

import type { ArtifactKind } from "@/shared/lib/artifactKind";
import { buildArtifactSrcDoc } from "../artifactDocument";
import { artifactUrl, revokeArtifact, stageArtifact } from "../stageArtifact";

/**
 * SECURITY — the entire trust boundary is the `sandbox` attribute below.
 *
 * `allow-scripts` lets the artifact's JS run; the deliberate ABSENCE of
 * `allow-same-origin` forces the frame to an opaque (`null`) origin, so its
 * scripts CANNOT read the parent's storage, cookies, relay session, or NIP-98
 * auth. **Do not add `allow-same-origin`** — that would hand agent-supplied
 * markup the user's session. Asserted by test, not left to review.
 *
 * Two renderers sit behind this one component:
 *
 * - **Untrusted (default)** — `srcDoc`. Inherits the app's CSP, so the
 *   artifact's scripts are refused and the document is inert. Measured on
 *   WKWebView: `docs/spike-csp-results.md` §3.
 * - **Trusted (after explicit opt-in)** — `artifact://localhost/{token}`. A real
 *   navigation, so it gets its own CSP from the protocol handler rather than
 *   inheriting the app's: scripts run, and `default-src 'none'` denies the
 *   frame any network access. The app's `script-src` is never involved.
 */
export const ARTIFACT_SANDBOX = "allow-scripts";

const FRAME_CLASS =
  "h-[calc(100vh-14rem)] w-full rounded-lg border border-border/60 bg-white";

/** Inert render: static HTML/SVG, scripts refused by the inherited CSP. */
function InertFrame({
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
      className={FRAME_CLASS}
      data-artifact-mode="inert"
      data-testid="artifact-frame"
      referrerPolicy="no-referrer"
      sandbox={ARTIFACT_SANDBOX}
      srcDoc={buildArtifactSrcDoc(kind, text)}
      title={title}
    />
  );
}

/**
 * Trusted render: the document is staged in Rust and framed over the
 * `artifact://` protocol, where its own scripts execute under a
 * `default-src 'none'` policy.
 *
 * The token is revoked when this component unmounts, so a closed panel leaves
 * nothing retrievable behind — the TTL is the backstop, not the mechanism.
 */
function TrustedFrame({
  kind,
  text,
  title,
}: {
  kind: ArtifactKind;
  text: string;
  title: string;
}) {
  const [token, setToken] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const doc = React.useMemo(
    () => buildArtifactSrcDoc(kind, text),
    [kind, text],
  );

  React.useEffect(() => {
    let active = true;
    let staged: string | null = null;

    stageArtifact(doc, kind)
      .then((next) => {
        if (!active) {
          // Unmounted mid-flight: revoke rather than leak the staged entry.
          void revokeArtifact(next);
          return;
        }
        staged = next;
        setToken(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (staged) void revokeArtifact(staged);
    };
  }, [doc, kind]);

  if (failed) {
    return (
      <p
        className="py-8 text-center text-sm text-muted-foreground"
        data-testid="artifact-run-error"
      >
        Could not prepare this file to run.
      </p>
    );
  }

  if (!token) {
    return (
      <div
        className={`${FRAME_CLASS} animate-pulse bg-muted/40`}
        data-testid="artifact-frame-staging"
      />
    );
  }

  return (
    <iframe
      className={FRAME_CLASS}
      data-artifact-mode="trusted"
      data-testid="artifact-frame"
      referrerPolicy="no-referrer"
      sandbox={ARTIFACT_SANDBOX}
      src={artifactUrl(token)}
      title={title}
    />
  );
}

export function ArtifactFrame({
  kind,
  text,
  title,
  trusted,
}: {
  kind: ArtifactKind;
  text: string;
  title: string;
  /** True only after the reader explicitly asked to run the artifact. */
  trusted: boolean;
}) {
  return trusted ? (
    <TrustedFrame kind={kind} text={text} title={title} />
  ) : (
    <InertFrame kind={kind} text={text} title={title} />
  );
}
