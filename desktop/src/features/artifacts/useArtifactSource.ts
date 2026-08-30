import { useQuery } from "@tanstack/react-query";

import { fetchMediaBytes } from "@/shared/api/tauriMedia";
import type { ArtifactTarget } from "./artifactPanelStore";

/**
 * Preview cap, deliberately far below the 50 MiB transport limit enforced by
 * `fetch_media_bytes` (`desktop/src-tauri/src/commands/media_download.rs`).
 * Decoding and laying out a multi-megabyte document blocks the renderer, and no
 * real artifact needs this much — so an oversize file becomes an explicit panel
 * state rather than a frozen window.
 */
export const MAX_ARTIFACT_PREVIEW_BYTES = 2 * 1024 * 1024;

export type ArtifactSource =
  | { status: "ready"; text: string }
  | { status: "too-large"; size: number };

/**
 * Fetch and decode an artifact's bytes for preview.
 *
 * Bytes travel over IPC through the existing Rust command, which applies the
 * relay-origin check, the `/media/` path check, the size cap and the MIME
 * policy. Nothing here loosens any of that; the artifact is fetched as data and
 * never navigated to.
 */
export function useArtifactSource(target: ArtifactTarget | null) {
  return useQuery<ArtifactSource>({
    queryKey: ["artifact-source", target?.url ?? null],
    enabled: target?.kind === "attachment",
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      if (target?.kind !== "attachment")
        throw new Error("no artifact selected");

      // Trust the imeta size when present and refuse before spending the
      // transfer; re-check after, because imeta is sender-authored.
      if (target.size != null && target.size > MAX_ARTIFACT_PREVIEW_BYTES) {
        return { status: "too-large", size: target.size };
      }

      const bytes = await fetchMediaBytes(target.url);
      if (bytes.byteLength > MAX_ARTIFACT_PREVIEW_BYTES) {
        return { status: "too-large", size: bytes.byteLength };
      }

      return {
        status: "ready",
        text: new TextDecoder("utf-8").decode(bytes),
      };
    },
  });
}
