//! `artifact://` custom protocol — serves a staged artifact document on an
//! isolated origin so its own scripts can run without touching the app's CSP.
//!
//! # Why this exists
//!
//! A `srcdoc` frame inherits the embedding document's CSP, so the app's
//! `script-src 'self'` silently refuses an artifact's inline scripts. Measured
//! on WKWebView — see `docs/spike-csp-results.md` §3. A real navigation gets its
//! own CSP instead of inheriting one, which is what this protocol provides.
//!
//! # Security contract (R1–R6 of `docs/plan-artifact-preview.md` §4.5)
//!
//! - **R1** Artifacts are addressed by an opaque token with a short TTL. An
//!   unknown, revoked, or expired token yields an error response, never content.
//! - **R2** Only bytes staged in this in-memory store are served. There is no
//!   filesystem read on the serve path, and no caller-supplied path segment ever
//!   reaches one — the token is validated as fixed-length hex before lookup.
//! - **R3** The served document carries `default-src 'none'` plus the minimum
//!   additions. `connect-src` is left to that default, so a rendered artifact
//!   cannot reach the network.
//! - **R4** The app-level CSP gains exactly one directive (`frame-src`).
//!   `script-src` is untouched; the `'unsafe-inline'` below applies only to the
//!   artifact document this handler serves.
//! - **R5** The embedding frame keeps `sandbox="allow-scripts"` with no
//!   `allow-same-origin` (enforced in the renderer, asserted by e2e).
//! - **R6** Responses carry `nosniff` and an explicit `Content-Type`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::http;
use uuid::Uuid;

/// How long a staged artifact stays retrievable.
///
/// Short enough that a token left behind in a log or a devtools panel is inert
/// long before anyone could reuse it; long enough that a reader can open an
/// artifact, read it, and let the frame reload without the document vanishing.
pub const ARTIFACT_TTL: Duration = Duration::from_secs(300);

/// Upper bound on concurrently staged artifacts.
///
/// The panel shows one at a time; the slack absorbs rapid switching. The cap
/// exists so a loop of stage calls cannot grow the process without limit.
const MAX_STAGED: usize = 8;

/// Token length in hex characters (128 bits from two v4 UUIDs).
const TOKEN_HEX_LEN: usize = 64;

/// CSP for the served artifact document (R3).
///
/// `default-src 'none'` denies everything not listed — including `connect-src`,
/// so artifact script cannot exfiltrate. `'unsafe-inline'` is scoped to this
/// response and never reaches the app document (R4).
const ARTIFACT_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; \
     style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactKind {
    Html,
    Svg,
}

impl ArtifactKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "html" => Some(Self::Html),
            "svg" => Some(Self::Svg),
            _ => None,
        }
    }

    fn content_type(self) -> &'static str {
        match self {
            // SVG is served as HTML: the staged body is an HTML host document
            // built by the renderer, not a standalone SVG document.
            Self::Html | Self::Svg => "text/html; charset=utf-8",
        }
    }
}

struct StagedArtifact {
    body: Vec<u8>,
    kind: ArtifactKind,
    staged_at: Instant,
}

/// In-memory staging store. Managed by Tauri as application state.
#[derive(Default)]
pub struct ArtifactStore {
    entries: Mutex<HashMap<String, StagedArtifact>>,
}

impl ArtifactStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stage a document and return its opaque token.
    ///
    /// Expired entries are dropped on every call, so the store cannot retain a
    /// document past its TTL even if nothing else touches it. When the cap is
    /// reached the oldest live entry is evicted.
    pub fn stage(&self, body: Vec<u8>, kind: ArtifactKind) -> Result<String, String> {
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());

        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "artifact store unavailable".to_string())?;

        let now = Instant::now();
        entries.retain(|_, entry| now.duration_since(entry.staged_at) < ARTIFACT_TTL);

        if entries.len() >= MAX_STAGED {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.staged_at)
                .map(|(key, _)| key.clone())
            {
                entries.remove(&oldest);
            }
        }

        entries.insert(
            token.clone(),
            StagedArtifact {
                body,
                kind,
                staged_at: now,
            },
        );
        Ok(token)
    }

    /// Look up a live artifact. Expired entries are removed and reported absent.
    fn take_live(&self, token: &str) -> Option<(Vec<u8>, ArtifactKind)> {
        let mut entries = self.entries.lock().ok()?;
        let entry = entries.get(token)?;
        if Instant::now().duration_since(entry.staged_at) >= ARTIFACT_TTL {
            entries.remove(token);
            return None;
        }
        Some((entry.body.clone(), entry.kind))
    }

    /// Drop a staged artifact — called when the panel closes or switches files.
    pub fn revoke(&self, token: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(token);
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.lock().map(|e| e.len()).unwrap_or(0)
    }

    #[cfg(test)]
    fn stage_at(&self, body: Vec<u8>, kind: ArtifactKind, staged_at: Instant) -> String {
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let mut entries = self.entries.lock().expect("test store lock");
        entries.insert(
            token.clone(),
            StagedArtifact {
                body,
                kind,
                staged_at,
            },
        );
        token
    }
}

/// Extract the token from a request path, rejecting anything that is not a bare
/// fixed-length hex string.
///
/// This is the whole of R2: the token never becomes a path, so traversal
/// sequences, absolute paths, and percent-encoded variants all fail the shape
/// check before any lookup — and the lookup itself is a hash-map read.
fn token_from_path(path: &str) -> Option<&str> {
    let token = path.strip_prefix('/')?;
    if token.len() != TOKEN_HEX_LEN {
        return None;
    }
    if !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(token)
}

fn error_response(status: u16, msg: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'")
        .body(msg.as_bytes().to_vec())
        .unwrap_or_else(|_| {
            http::Response::builder()
                .status(500)
                .body(Vec::new())
                .unwrap_or_default()
        })
}

/// Serve `artifact://localhost/{token}` from the staging store.
pub fn handle_artifact(
    store: &ArtifactStore,
    request: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    // Query and fragment are not part of the address; ignore them rather than
    // letting them widen the accepted token shape.
    let Some(token) = token_from_path(request.uri().path()) else {
        return error_response(404, "not found");
    };

    let Some((body, kind)) = store.take_live(token) else {
        // Unknown, revoked, and expired are one response: a caller learns
        // nothing about which it was, and never receives content (R1).
        return error_response(404, "not found");
    };

    http::Response::builder()
        .status(200)
        .header("content-type", kind.content_type())
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", ARTIFACT_CSP)
        .header("cache-control", "no-store")
        .body(body)
        .unwrap_or_else(|_| error_response(500, "response build failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str) -> http::Request<Vec<u8>> {
        http::Request::builder()
            .uri(format!("artifact://localhost{path}"))
            .body(Vec::new())
            .expect("test request")
    }

    fn header(response: &http::Response<Vec<u8>>, name: &str) -> String {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string()
    }

    // --- R1: token lifecycle ------------------------------------------------

    #[test]
    fn serves_a_staged_artifact() {
        let store = ArtifactStore::new();
        let token = store
            .stage(b"<h1>hi</h1>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let response = handle_artifact(&store, &request(&format!("/{token}")));
        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), b"<h1>hi</h1>");
    }

    #[test]
    fn r1_unknown_token_returns_an_error_and_no_content() {
        let store = ArtifactStore::new();
        store
            .stage(b"<h1>secret</h1>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let response = handle_artifact(&store, &request(&format!("/{}", "a".repeat(64))));
        assert_eq!(response.status(), 404);
        assert!(
            !String::from_utf8_lossy(response.body()).contains("secret"),
            "an error response must never carry artifact bytes"
        );
    }

    #[test]
    fn r1_revoked_token_returns_an_error() {
        let store = ArtifactStore::new();
        let token = store
            .stage(b"<h1>gone</h1>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        store.revoke(&token);
        let response = handle_artifact(&store, &request(&format!("/{token}")));
        assert_eq!(response.status(), 404);
        assert!(!String::from_utf8_lossy(response.body()).contains("gone"));
    }

    #[test]
    fn r1_expired_token_returns_an_error_and_is_dropped() {
        let store = ArtifactStore::new();
        let stale = Instant::now()
            .checked_sub(ARTIFACT_TTL + Duration::from_secs(1))
            .expect("clock supports the offset");
        let token = store.stage_at(b"<h1>stale</h1>".to_vec(), ArtifactKind::Html, stale);

        let response = handle_artifact(&store, &request(&format!("/{token}")));
        assert_eq!(response.status(), 404);
        assert!(!String::from_utf8_lossy(response.body()).contains("stale"));
        assert_eq!(store.len(), 0, "an expired entry must not be retained");
    }

    #[test]
    fn r1_staging_evicts_expired_entries() {
        let store = ArtifactStore::new();
        let stale = Instant::now()
            .checked_sub(ARTIFACT_TTL + Duration::from_secs(1))
            .expect("clock supports the offset");
        store.stage_at(b"old".to_vec(), ArtifactKind::Html, stale);
        store
            .stage(b"new".to_vec(), ArtifactKind::Html)
            .expect("stage");
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn r1_store_is_capped() {
        let store = ArtifactStore::new();
        for _ in 0..(MAX_STAGED + 4) {
            store
                .stage(b"x".to_vec(), ArtifactKind::Html)
                .expect("stage");
        }
        assert!(store.len() <= MAX_STAGED);
    }

    #[test]
    fn r1_tokens_are_unique() {
        let store = ArtifactStore::new();
        let a = store
            .stage(b"a".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let b = store
            .stage(b"b".to_vec(), ArtifactKind::Html)
            .expect("stage");
        assert_ne!(a, b);
        assert_eq!(a.len(), TOKEN_HEX_LEN);
    }

    // --- R2: no filesystem, no path traversal -------------------------------

    #[test]
    fn r2_rejects_traversal_and_absolute_paths() {
        let store = ArtifactStore::new();
        store
            .stage(b"<h1>secret</h1>".to_vec(), ArtifactKind::Html)
            .expect("stage");

        for path in [
            "/../../../../etc/passwd",
            "/etc/passwd",
            "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "/..%2f..%2fetc%2fpasswd",
            "/C:\\Windows\\win.ini",
            "/",
            "",
            "/short",
            // Right length, wrong alphabet — must still fail the shape check.
            &format!("/{}", "z".repeat(64)),
            // Right alphabet, one character too long.
            &format!("/{}", "a".repeat(65)),
        ] {
            let response = handle_artifact(&store, &request(path));
            assert_eq!(response.status(), 404, "path must be rejected: {path}");
            assert!(
                !String::from_utf8_lossy(response.body()).contains("secret"),
                "rejected path leaked content: {path}"
            );
        }
    }

    #[test]
    fn r2_token_shape_check_accepts_only_bare_hex() {
        assert!(token_from_path(&format!("/{}", "a".repeat(64))).is_some());
        assert!(token_from_path(&format!("/{}", "A".repeat(64))).is_some());
        assert!(token_from_path("/nested/aaa").is_none());
        // No leading slash: the path is always absolute, so this must not match.
        assert!(token_from_path(&"a".repeat(64)).is_none());
    }

    // --- R3: the served document's own CSP ----------------------------------

    #[test]
    fn r3_response_denies_everything_by_default() {
        let store = ArtifactStore::new();
        let token = store
            .stage(b"<p>x</p>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let response = handle_artifact(&store, &request(&format!("/{token}")));
        let csp = header(&response, "content-security-policy");
        assert!(csp.starts_with("default-src 'none'"), "got: {csp}");
    }

    #[test]
    fn r3_response_grants_no_network_access() {
        let store = ArtifactStore::new();
        let token = store
            .stage(b"<p>x</p>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let response = handle_artifact(&store, &request(&format!("/{token}")));
        let csp = header(&response, "content-security-policy");
        assert!(
            !csp.contains("connect-src"),
            "connect-src must stay at the default-src 'none' fallback: {csp}"
        );
        for scheme in ["http:", "https:", "ws:", "wss:"] {
            assert!(
                !csp.contains(scheme),
                "CSP must grant no network origin: {csp}"
            );
        }
    }

    #[test]
    fn r3_script_is_inline_only_and_scoped_to_this_response() {
        let store = ArtifactStore::new();
        let token = store
            .stage(b"<p>x</p>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let csp = header(
            &handle_artifact(&store, &request(&format!("/{token}"))),
            "content-security-policy",
        );
        assert!(csp.contains("script-src 'unsafe-inline'"));
        assert!(
            !csp.contains("script-src 'self'") && !csp.contains("'strict-dynamic'"),
            "the artifact document must not inherit app script privileges: {csp}"
        );
    }

    // --- R6: response headers -----------------------------------------------

    #[test]
    fn r6_response_carries_nosniff_and_an_explicit_content_type() {
        let store = ArtifactStore::new();
        let token = store
            .stage(b"<p>x</p>".to_vec(), ArtifactKind::Html)
            .expect("stage");
        let response = handle_artifact(&store, &request(&format!("/{token}")));
        assert_eq!(header(&response, "x-content-type-options"), "nosniff");
        assert_eq!(
            header(&response, "content-type"),
            "text/html; charset=utf-8"
        );
        assert_eq!(header(&response, "cache-control"), "no-store");
    }

    #[test]
    fn r6_error_responses_are_also_locked_down() {
        let store = ArtifactStore::new();
        let response = handle_artifact(&store, &request("/nope"));
        assert_eq!(header(&response, "x-content-type-options"), "nosniff");
        assert_eq!(
            header(&response, "content-security-policy"),
            "default-src 'none'"
        );
    }

    #[test]
    fn kind_parses_only_known_values() {
        assert_eq!(ArtifactKind::parse("html"), Some(ArtifactKind::Html));
        assert_eq!(ArtifactKind::parse("svg"), Some(ArtifactKind::Svg));
        assert_eq!(ArtifactKind::parse("pdf"), None);
        assert_eq!(ArtifactKind::parse(""), None);
    }
}
