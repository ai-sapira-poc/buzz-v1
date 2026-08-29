import { invokeTauri } from "@/shared/api/tauri";
import type { ArtifactKind } from "@/shared/lib/artifactKind";

/**
 * Stage an artifact document in the Rust-side store and get back its opaque
 * token, for use as `artifact://localhost/{token}`.
 *
 * The renderer never builds that URL from user- or sender-controlled text: it
 * hands over the document and receives a token, which is what keeps a
 * caller-supplied path out of the protocol handler entirely.
 */
export async function stageArtifact(
  document: string,
  kind: ArtifactKind,
): Promise<string> {
  return invokeTauri<string>("stage_artifact", { document, kind });
}

/** Drop a staged artifact once the panel stops showing it. */
export async function revokeArtifact(token: string): Promise<void> {
  await invokeTauri("revoke_artifact", { token });
}

/** Address of a staged artifact. Tokens come only from `stageArtifact`. */
export function artifactUrl(token: string): string {
  return `artifact://localhost/${token}`;
}
