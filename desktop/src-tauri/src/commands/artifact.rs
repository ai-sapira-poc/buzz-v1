//! Tauri commands backing the `artifact://` preview protocol.
//!
//! The renderer never constructs an artifact URL itself: it hands the document
//! text here and receives an opaque token back. That indirection is what keeps
//! the protocol handler free of any caller-supplied path (R2).

use tauri::State;

use crate::artifact_protocol::{ArtifactKind, ArtifactStore};

/// Upper bound on a staged document, mirroring the renderer's preview cap.
/// Documents this large are refused before they reach the store.
const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;

/// Stage an artifact document for preview and return its opaque token.
///
/// `kind` is validated against the known set rather than trusted, so a
/// malformed value cannot select an unintended Content-Type.
#[tauri::command]
pub fn stage_artifact(
    document: String,
    kind: String,
    state: State<'_, ArtifactStore>,
) -> Result<String, String> {
    let kind = ArtifactKind::parse(&kind).ok_or_else(|| "unsupported artifact kind".to_string())?;

    let bytes = document.into_bytes();
    if bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("artifact too large to preview".to_string());
    }

    state.stage(bytes, kind)
}

/// Drop a staged artifact — called when the panel closes or switches files.
#[tauri::command]
pub fn revoke_artifact(token: String, state: State<'_, ArtifactStore>) {
    state.revoke(&token);
}
