# Plan — Artifact preview in the desktop client

Status: **A1 shipped and manually verified; A2 implemented, pending manual verification**
Scope: desktop client (`desktop/`). Phase A (attachment preview) and Phase B (live dev-server preview).
Companion: `docs/spike-csp-results.md` — the empirical basis for §4.2, §4.4 and §6.

Phase A
: When an agent attaches an HTML or SVG file to a message, the user can preview it
  rendered inside the app, in an expandable right-side panel. Never a popup, never
  the OS browser. Delivered as two sequential milestones — **A1** (static render,
  ships standalone) and **A2** (script-enabled render via a custom protocol).

Phase B
: When an agent announces a local dev server in a message using the sentinel
  `[preview] http://localhost:PORT`, the client detects it and offers to open that
  live URL in the same panel.

This document is written in English to match the rest of `docs/`.

---
## 1. How attachments render today

### 1.1 `shared/ui/attachment.tsx` is not the dispatch point

`desktop/src/shared/ui/attachment.tsx` (201 lines) is a **pure primitive set** in the
shadcn/Radix idiom — `Attachment`, `AttachmentMedia`, `AttachmentContent`,
`AttachmentTitle`, `AttachmentDescription`, `AttachmentActions`, `AttachmentAction`,
`AttachmentTrigger`, `AttachmentGroup`. It contains **no MIME logic and no fetching**.
Its consumers are the composer (`features/messages/ui/ComposerAttachments.tsx`),
huddles, link-preview cards, and `shared/ui/markdown.tsx`.

Two primitives matter for this plan, because they already solve the
"one card, two actions" problem:

- `AttachmentTrigger` — `absolute inset-0 z-10`, the full-card click target.
- `AttachmentActions` / `AttachmentAction` — `relative z-20`, buttons that sit
  above the trigger without nesting inside it.

### 1.2 The real MIME dispatch lives in the markdown renderer

Received attachments arrive as markdown links carrying NIP-92 `imeta` metadata.
The decision chain is:

| Step | Location |
|---|---|
| Anchor renderer | `desktop/src/shared/ui/markdown.tsx:1240` (`MarkdownAnchor`) |
| 1. Agent/team snapshot? | `resolveSnapshotCard` — `desktop/src/shared/ui/markdownFileCard.ts:76`, called at `markdown.tsx:1266` |
| 2. Generic file? | `resolveFileCard` — `desktop/src/shared/ui/markdownFileCard.ts:130`, called at `markdown.tsx:1294` |
| 3. Buzz deep link / message link / external | rest of `MarkdownAnchor` |
| Images & video | separate `img:` renderer at `markdown.tsx:1484` |

`resolveFileCard` is the gate that matters:

```ts
// markdownFileCard.ts:130
if (!href || !entry?.m || entry.m.startsWith("image/") || entry.m.startsWith("video/"))
  return null;
```

Anything that is **not** `image/*` or `video/*` becomes a `ResolvedFileCard` and
renders as `<FileCard>` (`markdown.tsx:1301`). This is where both HTML and SVG land
(see §4.3 for why SVG does not take the image path).

**This is the hook point for the Phase A "Preview" affordance.**

### 1.3 `FileCard` must be restructured before it can carry a second action

`desktop/src/shared/ui/markdown/FileCard.tsx:32` renders the **entire card as a single
`<button>`** whose `onClick` calls `invokeTauri("download_file", …)` (line 50). A
"Preview" button cannot be nested inside it — nested interactive elements are invalid
HTML and will fail accessibility review.

The fix is mechanical and uses primitives that already exist: rebuild `FileCard` on
`Attachment` + `AttachmentTrigger` (download, `z-10`, full bleed) + `AttachmentActions`
(preview, `z-20`). No new primitive is needed.

### 1.4 `SimpleImageLightbox` is *not* the model to copy

`desktop/src/shared/ui/SimpleImageLightbox.tsx` (74 lines) is a centred modal overlay
for images. It is the wrong precedent for this feature — the requirement is an
expandable docked side panel, not a modal. Use §2 instead.

---

## 2. Existing side-panel pattern and state management

### 2.1 `RawEventRail` is not a panel

`desktop/src/features/agents/ui/RawEventRail.tsx` (49 lines) is a `<section>` of
`<details>` rows — the *content* of a tab inside the agent session view. It carries no
width, resize, close, or docking behaviour. **Do not model the artifact panel on it.**

### 2.2 The canonical right panel is `AuxiliaryPanel`

`desktop/src/shared/layout/AuxiliaryPanel/index.ts` re-exports the real thing:

- `AuxiliaryPanel` — `desktop/src/shared/layout/AuxiliaryPanelShell.tsx:53`,
  documented as *"Right-side auxiliary panel shell for split and standalone overlay
  layouts."* Props include `widthPx`, `onClose`, `onResizeStart`, `onResetWidth`,
  `header`, `footer`, `layout` (`"split" | "standalone"`), `isSinglePanelView`,
  `testId`.
- `AuxiliaryPanelHeader` / `AuxiliaryPanelHeaderActions` / `AuxiliaryPanelTitle` /
  `AuxiliaryPanelBody`.
- Layout constants: `AUXILIARY_PANEL_DEFAULT_WIDTH_PX`, `AUXILIARY_PANEL_MIN_WIDTH_PX`,
  `AUXILIARY_PANEL_MAX_WIDTH_PX`, `clampAuxiliaryPanelWidth`,
  `getAuxiliaryPanelMaxWidth`.

Resizing and persistence are already solved by
`desktop/src/shared/hooks/useThreadPanelWidth.ts:62` — clamps to the viewport and
persists to `sessionStorage`. Consumers today: `ChannelScreen`, `HomeView`,
`PulseScreen`, `AgentsScreen`, `ProjectChannelHome`.

### 2.3 There is already a generic slot in the channel view — use it

`desktop/src/features/channels/ui/ChannelPane.tsx` accepts a ready-made auxiliary-panel
slot (props declared around line 92):

- `idleAuxiliaryPanel: React.ReactNode`
- `idleAuxiliaryTitle: string`
- `idleAuxiliaryHeaderActions`
- `onCloseIdleAuxiliaryPanel: () => void`
- `idleAuxiliaryOverridesThread: boolean`

`ChannelPane.tsx:548-562` wraps whatever is passed in
`desktop/src/features/channels/ui/IdleAuxiliaryPanel.tsx:18`, which **already**
composes `AuxiliaryPanel` + `AuxiliaryPanelHeader` + `AuxiliaryPanelBody` and receives
`widthPx` from the channel's `useThreadPanelWidth`
(`ChannelScreen.tsx:150-152`). On narrow viewports it degrades to `FocusThreadDrawer`.

Today this slot is fed by exactly one caller —
`desktop/src/features/projects/ui/ProjectChannelHome.tsx:317` (`workspaceSheet`).
The ordinary chat route (`desktop/src/app/routes/ChannelRouteScreen.tsx:312`) does
**not** pass it, so the slot is free.

> **Design consequence:** `ArtifactPanel` must render only the panel *body*. The shell,
> header chrome, resize handle, close button, and overlay behaviour all come from
> `IdleAuxiliaryPanel`. Title and header buttons are passed as `idleAuxiliaryTitle`
> and `idleAuxiliaryHeaderActions`. Do not wrap `AuxiliaryPanel` a second time.

### 2.4 State management: no store library

`desktop/package.json` has **no** zustand / redux / jotai / valtio. Global state uses
TanStack Query (server state), TanStack Router (URL state), React context, and two
blessed local idioms:

1. **Module-level store + `useSyncExternalStore`** —
   `desktop/src/features/terminal/terminalPanelStore.ts`. A module `snapshot`, a
   `Set` of listeners, a `publish()` helper, exported mutators, a `use…()` hook, plus
   `resetTerminalPanelForTests()` / `getTerminalPanelSnapshotForTests()`. **This is the
   pattern the artifact panel should copy.**
2. **Module pending payload + window event** —
   `desktop/src/features/agents/openSnapshotImportFromUrlEvent.ts:27`, for one-shot
   cross-view handoffs. Not needed here.

### 2.5 How the markdown renderer talks to the app

`MarkdownRuntime` (`desktop/src/shared/ui/markdown/types.ts:38`) flows through
`MarkdownRuntimeContext` (`desktop/src/shared/ui/markdown/runtimeContext.ts:23`) and
carries optional callbacks — `onOpenChannel`, `onOpenEntityLink`, `onOpenMessageLink`,
and notably the optional `onImportSnapshotFromUrl?`.

`markdown.tsx:1777` builds the runtime and wires `onImportSnapshotFromUrl` (line 1790)
straight to a module-level store function. **Phase A should add `onOpenArtifact?` the
same way**, so `FileCard` stays a dumb presentational component.

---

## 3. Fetching attachment bytes in the client

`desktop/src/shared/api/tauriMedia.ts:66`:

```ts
export async function fetchMediaBytes(url: string): Promise<Uint8Array<ArrayBuffer>>
```

It invokes the Rust command `fetch_media_bytes`
(`desktop/src-tauri/src/commands/media_download.rs:156`), which enforces:

- `validate_download_url` (same file, line 31) — HTTPS only, except `http` for
  `localhost` / `127.0.0.1` / `[::1]`; **origin must equal the relay origin**; path must
  start with `/media/`. This is the SSRF gate.
- `MAX_DOWNLOAD_BYTES = 50 MiB` (line 20) and a 60 s timeout.
- `detect_and_validate_mime` (`desktop/src-tauri/src/commands/media.rs:301`) against
  `BLOCKED_MIME` (line 121).

Bytes cross IPC as a raw `ArrayBuffer`, not a JSON number array.

Related helpers:

- `fetchSnapshotBytes` (`tauriMedia.ts:111`) — the SHA-256-verified variant used by
  `AgentSnapshotCard`. Worth mirroring if we later want hash-verified artifacts; the
  `imeta` `x` field is already parsed (`markdownFileCard.ts:9`).
- `rewriteRelayUrl` (`desktop/src/shared/lib/mediaUrl.ts:312`) — maps a relay media URL
  onto the local media-proxy port. `resolveFileCard` already applies it to `card.href`,
  so `FileCard` receives a rewritten URL.

**Use `fetchMediaBytes` for Phase A**, then `new TextDecoder("utf-8").decode(bytes)`.

---

## 4. Security boundary — non-negotiable

### 4.1 What must not change

`crates/buzz-media/src/validation.rs:228`:

```rust
pub fn serve_inline(mime: &str) -> bool {
    mime.starts_with("image/") || mime.starts_with("video/")
}
```

`text/html` returns `false` **on purpose**. The relay therefore serves HTML with
`Content-Disposition: attachment` + `nosniff` + `CSP: default-src 'none'`.
`crates/buzz-media/src/validation.rs:2642`
(`test_validate_file_html_accepted_as_inert_download`) asserts exactly this and says so:
*"text/html must never be served inline — it must force download"*.

**This plan does not touch `serve_inline`, `BLOCKED_FILE_MIME_TYPES`, or the desktop
`BLOCKED_MIME` mirror. No artifact is ever rendered by pointing a frame at a media-server
URL.**

### 4.2 Rendering technique — measured, not assumed

The original design was `srcdoc` + `sandbox="allow-scripts"`, following
`web/src/features/repos/ui/RepoBlobViewer.tsx:157`:

```ts
const RUN_SANDBOX = "allow-scripts";
// SECURITY — the entire trust boundary is the `sandbox` attribute below.
// `allow-scripts` lets the page's JS run; the deliberate ABSENCE of
// `allow-same-origin` forces the frame to an opaque (`null`) origin …
// Do not add `allow-same-origin`: that would hand pushed code the user's session.
```

The spike (`docs/spike-csp-results.md`) measured this against a real WKWebView and
found it **half-true in this app**:

- **Static HTML and SVG render correctly** in a `srcdoc` frame under the current CSP,
  with no configuration change. This is Milestone **A1**.
- **Inline scripts never execute.** An `about:srcdoc` document inherits the embedder's
  CSP, and the app's `script-src 'self'` has no `'unsafe-inline'`. No CSP edit fixes
  this without relaxing `script-src` globally, which is out of bounds. `blob:` and
  `data:` inherit identically; WebKit has no per-iframe `csp` attribute.

Script-bearing artifacts therefore need a **real navigation**, which gets its own CSP
instead of inheriting. That is Milestone **A2** — the `artifact://` protocol (§4.5).

The `allow-same-origin` prohibition is unchanged and applies to both milestones.

> **A1 is inert by construction.** Its frame cannot execute script because the inherited
> `script-src` forbids it — and the A2 `frame-src` addition does not change that (the
> spike verified `frame-src 'self'` leaves `srcdoc` scripts blocked). A1 therefore needs
> no "Run" opt-in gate. A2 introduces execution and reinstates the gate (§7.2).
>
> **Inertness is a production-only property, and the e2e suite cannot assert it.**
> The CSP is injected by Tauri at runtime; under Playwright the app is served by a
> plain preview server with no such header, so a `srcdoc` frame's inline script does
> run there (measured while building A1). Two consequences: the guard for this
> property is the CSP plus the spike, never a green e2e run; and the containment that
> *does* hold everywhere is the `sandbox` attribute — with no `allow-same-origin` the
> frame has an opaque origin, so artifact script cannot reach the user's session
> whether or not it executes. That is what §10.1 asserts.

### 4.3 SVG: classify by extension, not by MIME

`image/svg+xml` appears in **both** deny-lists
(`crates/buzz-media/src/validation.rs:87` and
`desktop/src-tauri/src/commands/media.rs:121`). Taken at face value, SVG attachments
would be impossible.

In practice they are not, and the repo says why —
`crates/buzz-media/src/validation.rs:1574`:

```rust
// SVG starts with XML declaration — infer won't detect it as image
```

`infer` has no SVG matcher, so `infer::get()` returns `None`, the generic file path
falls through to `("application/octet-stream", "bin")` (`validation.rs:217`), and the
same fallback lets the bytes back through `detect_and_validate_mime` on download.

Consequences for the implementation:

1. An uploaded `.svg` carries `imeta m=application/octet-stream`. Because that is
   neither `image/*` nor `video/*`, it reaches `resolveFileCard` — the same path as
   HTML. Good: one code path serves both.
2. **Detect SVG by filename extension, never by MIME.** A MIME-based check will never
   match.
3. **Latent fragility to record:** if `infer` ever gains an SVG matcher, uploads *and*
   downloads of SVG start failing closed, and this feature silently loses SVG support.
   Add a regression test asserting the current classification so the change is loud.
   (`validation.rs:2687` already pins the deny-list contents in the same spirit.)

### 4.4 CSP findings (spike closed)

`desktop/src-tauri/tauri.conf.json` sets `default-src 'self'` and declares **no
`frame-src`**, so frames fall back through `child-src` to `default-src`. There were zero
iframes in `desktop/src` before this work.

Measured on WKWebView (macOS 15.6.1, WebKit 18.6, matching wry 0.55.1 / Tauri 2.11.5):

| Probe | Current CSP | With scoped addition |
|---|---|---|
| `srcdoc` + inline script | script blocked (frame renders, static content paints) | still blocked — `frame-src` is not the cause |
| `srcdoc`, static markup only | **renders** | renders |
| `iframe src="http://127.0.0.1:PORT"` | blocked (`frame-src` violation) | loads, own script runs, zero violations |
| `iframe src="artifact://…"` | blocked (`frame-src` violation) | loads, own script runs, zero violations |

Resolution, per the approved decision:

- **Milestone A1** ships on `srcdoc`, static only, **no CSP change at all**.
- **Milestone A2** adds `artifact:` to `frame-src` only (§4.5).
- **Phase B** adds loopback origins to `frame-src` only (§9).

`script-src`, `default-src`, `connect-src` and every other app-level directive stay
exactly as they are, in all milestones.

Linux/WebKitGTK and Windows/WebView2 are **unverified** — see
`docs/spike-csp-results.md` §7. Re-run the harness before shipping to those platforms.

### 4.5 The `artifact://` protocol (Milestone A2) — non-negotiable requirements

The spike verified this design end to end. Measured from inside a running artifact:
`document.origin` is `"null"`, `parent.document` throws `SecurityError`, `localStorage`
throws `SecurityError`, `document.cookie` is empty, and outbound `fetch()` is **blocked**
by the response's own CSP — while its inline script still runs.

That last property is why A2 is a *stronger* posture than `srcdoc` would have been: a
`srcdoc` frame inherits the app's `connect-src`, which currently allows
`https: http: wss: ws:`.

The following are requirements, not suggestions. Each maps to a test in §10.3.

| # | Requirement |
|---|---|
| **R1** | The renderer addresses artifacts by an **opaque token**, never by path or URL. Tokens are single-use **or** short-TTL. A token that was never staged, was already consumed, or has expired returns an **error response — never content**. |
| **R2** | The handler serves **only** bytes staged in its own in-memory store. It must never read an arbitrary filesystem path, and must never accept a caller-supplied path segment that reaches the filesystem. |
| **R3** | The served document carries its own CSP: `default-src 'none'`, plus the minimum additions needed — `script-src 'unsafe-inline'`, and `style-src 'unsafe-inline'` / `img-src data: blob:` only if required. **`connect-src` stays at `'none'`** (inherited from `default-src 'none'`). |
| **R4** | The app-level CSP changes by **exactly one directive**: `frame-src` gains `artifact:`. `script-src` is untouched. The `'unsafe-inline'` in R3 applies only to the artifact document served by our own handler. |
| **R5** | The frame keeps `sandbox="allow-scripts"` as defence in depth. `allow-same-origin` is never added. |
| **R6** | Response also carries `X-Content-Type-Options: nosniff` and an explicit `Content-Type`. |

Implementation follows the existing, reviewed pattern in this repo:
`desktop/src-tauri/src/lib.rs:216` registers
`register_asynchronous_uri_scheme_protocol("buzz-media", …)`, handled by
`desktop/src-tauri/src/media_proxy.rs:158`.

---

## 5. Link detection today, and where Phase B attaches

### 5.1 Previews are snapshot-only, by design

`desktop/src/shared/ui/markdown/useMessageLinkPreviews.ts` states the privacy model:
external URLs render **exclusively** from sender-authored
`["link-preview","snapshot",…]` tags — *"recipients never contact external sites."*

### 5.2 The existing extractor cannot see `http://localhost`

`desktop/src/shared/lib/linkPreview.ts:53` (`SUPPORTED_URL_RE`) admits generic links
only over **HTTPS**; plain `http://` is allowed solely for the relay git path shape
`/git/<64-hex>/…`. `parseSupportedLinkPreview` (line 544) re-checks and returns `null`
for any non-HTTPS generic link.

So `http://localhost:5173` will never be produced by
`extractSupportedLinkPreviews` (line 630).

> **Do not relax `SUPPORTED_URL_RE` or `parseSupportedLinkPreview`.** Widening them to
> admit `http://` would weaken the HTTPS-only preview boundary for *every* message.
> Phase B gets its own narrow detector instead.

### 5.3 Where to render the Phase B affordance

`markdown.tsx:1886` renders `<LinkPreviewList previews={resolvedLinkPreviews} …>`
just inside the `MarkdownRuntimeContext.Provider` (line 1874). A `DevPreviewCallout`
rendered as a sibling there gets message content, `interactive`, and the runtime for
free.

Related components for reference: `shared/ui/markdown/entityLinks.tsx`,
`MessageLinkPill.tsx`, `ExternalLinkAnchor.tsx`, `shared/ui/link-preview-list.tsx`.

---

## 6. Architecture

Convention check (`AGENTS.md`, `desktop/scripts/check-file-sizes.mjs:8`): feature code
lives in `features/<name>/`, reusable primitives in `shared/ui/` and `shared/lib/`,
unit tests are colocated `*.test.mjs`, and **no file may exceed 1000 lines**.
`markdown.tsx` is already 1905 lines, so edits to it must stay surgical — all new logic
goes in new files.

### 6.1 Milestone split

| | A1 — static preview | A2 — script-enabled preview |
|---|---|---|
| Renderer | `<iframe srcDoc>` | `<iframe src="artifact://localhost/{token}">` |
| CSP change | **none** | `frame-src` gains `artifact:` |
| Rust work | none | new protocol + staging command |
| Scripts | do not run (by design) | run, network-isolated |
| Opt-in gate | not needed (inert) | required before execution |
| Ships alone? | **yes** | extends A1 |

A1 delivers the whole user-visible surface — detection, the Preview action, the docked
panel, Preview/Source tabs, resize, persistence. A2 swaps the renderer behind the same
UI and adds the execution gate.

### 6.2 New files — Milestone A1

| Path | Purpose |
|---|---|
| `desktop/src/shared/lib/artifactKind.ts` | Pure classifier. `resolveArtifactKind({ filename, mime }): "html" \| "svg" \| null`. HTML when `mime === "text/html"` **or** filename ends `.html`/`.htm`; SVG when filename ends `.svg` (§4.3). In `shared/lib` so `shared/ui` can use it without importing from `features/`. |
| `desktop/src/shared/lib/artifactKind.test.mjs` | `.html`, `.htm`, `.svg`, `application/octet-stream` + `.svg`, `text/html` with no extension, `.txt`, `.pdf`, uppercase extensions, missing entry. |
| `desktop/src/features/artifacts/artifactPanelStore.ts` | Module store + `useSyncExternalStore`, copying `terminalPanelStore.ts`, incl. `resetArtifactPanelForTests()` / `getArtifactPanelSnapshotForTests()`. |
| `desktop/src/features/artifacts/artifactPanelStore.test.mjs` | Open / replace / close; listener notification; tab selection; test reset. |
| `desktop/src/features/artifacts/useArtifactSource.ts` | TanStack Query hook: `fetchMediaBytes(url)` → size check → `TextDecoder("utf-8")`. Query key `["artifact-source", url]`. |
| `desktop/src/features/artifacts/ui/ArtifactPanel.tsx` | Panel **body only** (§2.3). Owns the Preview/Source tab state and the load/error/oversize states. |
| `desktop/src/features/artifacts/ui/ArtifactFrame.tsx` | The sandboxed frame. Holds `ARTIFACT_SANDBOX` and the restated security comment. A1: `srcDoc`. |
| `desktop/src/features/artifacts/ui/ArtifactSourceView.tsx` | `<pre>` source view for the Source tab, and the fallback on error/oversize. |

Store shape (A2 fields marked):

```ts
export type ArtifactTarget =
  | { kind: "attachment"; url: string; filename: string; artifact: "html" | "svg"; size?: number }
  | { kind: "devServer"; url: string; port: number };          // Phase B

type Snapshot = {
  target: ArtifactTarget | null;
  tab: "preview" | "source";
  trusted: boolean;   // A2 only — explicit opt-in before scripts execute
};
```

### 6.3 New files — Milestone A2

| Path | Purpose |
|---|---|
| `desktop/src-tauri/src/artifact_protocol.rs` | Scheme handler + in-memory staging store. Implements R1–R3, R6. Modelled on `media_proxy.rs`. |
| `desktop/src-tauri/src/artifact_protocol/tests.rs` (or inline `#[cfg(test)]`) | R1/R2/R3/R6 coverage (§10.3). |

### 6.4 New files — Phase B

| Path | Purpose |
|---|---|
| `desktop/src/shared/lib/devPreviewLink.ts` | `parseDevPreviewAnnouncements(content): DevPreviewTarget[]`. Anchored on the `[preview] ` sentinel; host restricted to `localhost` / `127.0.0.1` / `[::1]`; scheme `http` only; port validated `1-65535`; capped (mirror `MAX_PREVIEWS = 8`, `linkPreview.ts:57`) and de-duplicated. |
| `desktop/src/shared/lib/devPreviewLink.test.mjs` | Negative cases mandatory: `http://evil.com:3000`, `http://localhost.evil.com:3000`, `file:///etc/passwd`, port `0`, port `99999`, sentinel inside a fenced code block. |
| `desktop/src/features/artifacts/ui/DevPreviewCallout.tsx` | In-message callout. Shows the origin in plain text; never auto-opens. |

### 6.5 Modified files

| Path | Milestone | Change |
|---|---|---|
| `desktop/src/shared/ui/markdown/types.ts` | A1 | Add `onOpenArtifact?: (target: ArtifactTarget) => void` to `MarkdownRuntime` (line 38). |
| `desktop/src/shared/ui/markdownFileCard.ts` | A1 | Add `previewKind?: "html" \| "svg"` to `ResolvedFileCard`, via `resolveArtifactKind`. |
| `desktop/src/shared/ui/markdownFileCard.test.mjs` | A1 | Cases for `previewKind`. |
| `desktop/src/shared/ui/markdown/FileCard.tsx` | A1 | Restructure per §1.3 onto `Attachment` + `AttachmentTrigger` (download) + `AttachmentActions` (preview). Preserve `data-testid="file-card"` and the native-download comment. |
| `desktop/src/shared/ui/markdown.tsx` | A1 | Wire `onOpenArtifact` in the runtime memo (line 1777, mirroring `onImportSnapshotFromUrl` at 1790); pass `previewKind`/`onPreview` to `<FileCard>` (line 1301). |
| `desktop/src/app/routes/ChannelRouteScreen.tsx` | A1 | Feed the auxiliary slot: `idleAuxiliaryPanel`, `idleAuxiliaryTitle`, `idleAuxiliaryHeaderActions`, `onCloseIdleAuxiliaryPanel` into `<ChannelScreen>` (line 312). |
| `desktop/src-tauri/src/lib.rs` | A2 | Register the `artifact` scheme (~8 lines, copy of line 216). |
| `desktop/src-tauri/tauri.conf.json` | A2 | `frame-src 'self' artifact:` — **one directive**. |
| `desktop/src/features/artifacts/ui/ArtifactFrame.tsx` | A2 | `srcDoc` → `src`, behind the opt-in gate. |
| `desktop/src/shared/ui/markdown.tsx` | B | Render `<DevPreviewCallout>` beside `<LinkPreviewList>` (line 1886). |
| `desktop/src-tauri/tauri.conf.json` | B | Extend `frame-src` with loopback origins. |

Not modified, deliberately, in any milestone: `crates/buzz-media/src/validation.rs`,
`desktop/src-tauri/src/commands/media.rs`, `desktop/src/shared/lib/linkPreview.ts`,
`desktop/src/shared/ui/attachment.tsx`.

### 6.6 Data flow (A1)

```
imeta link in message
  → MarkdownAnchor (markdown.tsx:1240)
  → resolveFileCard + resolveArtifactKind         [pure, unit-tested]
  → <FileCard previewKind="html" onPreview={…}>
  → runtime.onOpenArtifact(target)                [MarkdownRuntime context]
  → openArtifact(target)                          [module store]
  → ChannelRouteScreen re-renders
  → ChannelScreen → ChannelPane → IdleAuxiliaryPanel → <ArtifactPanel>
  → useArtifactSource → fetchMediaBytes → fetch_media_bytes (Rust: SSRF + 50 MiB + MIME)
  → decode UTF-8
  → Preview tab: <ArtifactFrame srcDoc sandbox="allow-scripts">   (inert — §4.2)
    Source tab: <ArtifactSourceView>
```

A2 replaces the last two lines: stage bytes → token → `<ArtifactFrame src="artifact://localhost/{token}">`,
gated on an explicit user action.

---

## 7. Implementation steps

### 7.1 Milestone A1 — static preview (ships standalone)

1. `shared/lib/artifactKind.ts` + test. Pure, no UI. Land first.
2. `markdownFileCard.ts`: add `previewKind`; extend `markdownFileCard.test.mjs`.
3. `features/artifacts/artifactPanelStore.ts` + test, copying `terminalPanelStore.ts`
   including the test helpers.
4. Restructure `FileCard.tsx` onto the `Attachment` primitives; Preview action rendered
   only when `previewKind` is set. No nested buttons; download path unchanged.
5. Thread `onOpenArtifact` through `markdown/types.ts` → `markdown.tsx` runtime memo →
   `MarkdownAnchor` → `FileCard`.
6. `useArtifactSource.ts`: fetch + decode. Cap the preview **well below** the 50 MiB
   transport limit — 2 MiB — and surface oversize as an explicit panel state.
7. `ArtifactSourceView.tsx`, then `ArtifactFrame.tsx` with
   `ARTIFACT_SANDBOX = "allow-scripts"` as a module constant and the §4.2 security
   comment restated at the call site.
8. `ArtifactPanel.tsx`: body-only. Preview/Source tabs. States:
   `loading | ready | error | too-large`.
9. Wire the auxiliary slot in `ChannelRouteScreen.tsx`.
10. Tests (§10.1). Run `just ci`.

**A1 done when:** an agent attaches `report.html`; the card shows a Preview action;
clicking docks the right panel; the Preview tab renders the file; the Source tab shows
its text; the panel resizes and persists width; closing restores full width; `diagram.svg`
behaves identically; `serve_inline` is untouched; no HTML is ever loaded by URL from the
media server; **no CSP change was needed**.

### 7.2 Milestone A2 — `artifact://` renderer

1. `artifact_protocol.rs`: staging store keyed by opaque token (R1), in-memory only
   (R2). Decide single-use vs TTL and state it in the module doc comment.
2. `stage_artifact(bytes, kind) -> token` Tauri command.
3. Scheme handler: serve staged bytes with the R3 CSP, R6 headers; error for unknown,
   consumed, or expired tokens.
4. Register the scheme in `lib.rs` next to `buzz-media` (line 216).
5. `tauri.conf.json`: add `artifact:` to `frame-src` — this single line is the whole
   app-CSP change (R4). Flag it for explicit review.
6. Frontend: `ArtifactFrame` switches to `src`; `ArtifactPanel` gains the opt-in gate —
   Preview tab shows the inert static render until the user chooses to enable scripts.
7. Tests (§10.3), including the in-artifact isolation probes.

**A2 done when:** an artifact's own JavaScript runs; `parent`, storage and network are
all provably unreachable from inside it; the only app-CSP delta is `frame-src`.

---

## 8. Implementation steps — Phase B

1. `shared/lib/devPreviewLink.ts` + test, negative cases first. Pure. Land alone.
2. `DevPreviewCallout.tsx` — detected URL, explicit "Open preview" button, origin shown
   in plain text. **Never auto-open.**
3. Render beside `<LinkPreviewList>` (`markdown.tsx:1886`), gated on `interactive`.
4. Extend `ArtifactTarget` with the `devServer` variant; `ArtifactPanel` renders
   `<iframe src={url}>` — `srcdoc` is impossible for a live server.
5. `tauri.conf.json`: extend `frame-src` with loopback origins only. Never a bare
   `http:` wildcard. Separate review.
6. Sandbox decision for live previews: `allow-scripts` alone gives an opaque origin,
   which breaks dev servers needing `localStorage` or same-origin `fetch`, and likely
   breaks Vite HMR. Adding `allow-same-origin` for a loopback frame is materially weaker
   than A2 and is **a separate decision with its own review**. Start without it and
   measure what actually breaks.
7. Dead-server case: a connection-refused frame renders blank. Show an explicit
   "cannot reach localhost:PORT" state with retry.

**Upgrade path, documented but not implemented:** the `[preview]` sentinel is a message
convention, so any author can emit it and clients that do not support it see raw text.
A dedicated event tag would be structured, forgeable only by the event signer, and
invisible to non-supporting clients — strictly better. Ship the sentinel for the
prototype; treat the tag as the follow-up when the feature earns it.

---

## 9. Phase B CSP delta

Stated separately because it is the one place Phase B touches app-level configuration:

```
frame-src 'self' artifact: http://localhost:* http://127.0.0.1:*
```

`artifact:` comes from A2; the loopback entries are Phase B. Nothing else changes.

---

## 10. Testing

### 10.1 A1

Unit (`*.test.mjs`, colocated):

- `artifactKind.test.mjs`, `artifactPanelStore.test.mjs`, extended
  `markdownFileCard.test.mjs`.

Playwright (`desktop/tests/`):

- `.html` attachment shows a Preview action; opening docks the panel.
- Preview/Source tabs switch and the Source tab shows the raw text.
- Panel resize persists across reload (`sessionStorage`).
- `.svg` attachment follows the same path with `m=application/octet-stream`.
- A non-previewable attachment (`.pdf`, `.zip`) shows **no** Preview action.
- The rendered frame's `sandbox` attribute equals `"allow-scripts"` exactly.

### 10.2 Standing security regressions

- Rust: `serve_inline("text/html") == false` still holds —
  `crates/buzz-media/src/validation.rs:2642` already covers this. **Do not delete it.**
- Rust: pin the SVG classification from §4.3 so an `infer` upgrade that adds an SVG
  matcher fails loudly instead of silently breaking SVG attachments.
- Frontend: assert `sandbox` never contains `allow-same-origin`, in every milestone.

### 10.3 A2 — verifiable criteria for §4.5

| Req | Test |
|---|---|
| R1 | Unknown token → error, not content. Consumed/expired token → error, not content. Assert the response body carries no artifact bytes. |
| R2 | A token-shaped path containing traversal (`../`, absolute paths, URL-encoded variants) never reads from disk. Assert the handler has no filesystem read on the serve path. |
| R3 | Served response headers include `default-src 'none'` and do **not** include any `connect-src` allowance. |
| R4 | Snapshot test on `tauri.conf.json`: the CSP differs from the pre-A2 baseline **only** in `frame-src`; `script-src` is byte-identical. |
| R5 | Frame `sandbox === "allow-scripts"`. |
| R6 | Response carries `nosniff` and an explicit `Content-Type`. |
| In-artifact isolation | Split by what each environment can actually prove — see §10.5. |

### 10.5 Isolation: what is automated, and what is not

The `artifact://` scheme is a Tauri protocol. A browser-based Playwright harness
cannot load the trusted frame, so the isolation contract is verified in three
places rather than one:

| Layer | How it is verified | Where |
|---|---|---|
| Response CSP is correct | Rust unit tests on the served headers (R3) | `artifact_protocol.rs` |
| App CSP is not widened | Snapshot test pinning `script-src` byte-for-byte (R4) | `shared/lib/appCsp.test.mjs` |
| Frame sandbox denies escape | `test-fixtures/sondas.html` runs its real escape attempts inside the inert frame, which executes scripts under Playwright (no CSP there) — parent, storage and origin probes must all report BLOCKED | `tests/e2e/artifact-preview.spec.ts` |
| Network egress is denied | **Not automated.** Requires the real protocol under a real CSP | manual: `sondas.html` in the packaged app |
| The whole contract end to end | **Not automated.** | manual: `sondas.html` must report ISOLATION HOLDS |

`test-fixtures/sondas.html` is deliberately both: a fixture the e2e suite drives,
and a file a human attaches to a message for the manual pass. One artifact, so
the two cannot drift apart.

**Upgrade path, documented and not implemented:** a WKWebView harness in the
repo — the shape of the one in `docs/spike-csp-results.md` §1 — could register a
scheme handler, serve the real `ARTIFACT_CSP`, and assert the network probes
automatically on macOS. That would close the last manual row. It is not built
because it would test a Swift reimplementation of the handler rather than the
Rust one, and a harness that drifts from the code it stands in for is worse than
an honest manual step. Revisit if the manual pass becomes a recurring cost, or
if Tauri gains a supported way to drive its protocols from an integration test.

### 10.4 Phase B

- A message with the sentinel renders the callout and does **not** auto-load.
- `[preview] http://evil.com:3000` renders nothing.
- Sentinel inside a fenced code block renders nothing.

Gates: `just ci` before every PR; `git commit -s` (DCO); no file over 1000 lines.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Someone adds `allow-same-origin` to "fix" a broken artifact | **High** | Module constant + §10.2 assertion + the §4.2 comment. |
| A2 token lifecycle bug leaks a stale artifact to the wrong viewer | **High** | R1 + §10.3; single-use or short TTL; tokens never constructed renderer-side. |
| `script-src` gets relaxed under pressure to make an artifact work | **High** | R4 snapshot test on `tauri.conf.json`. |
| `infer` gains an SVG matcher and silently breaks SVG (§4.3) | Medium | §10.2 pinning test. |
| Linux/Windows webviews behave differently (unverified) | Medium | Re-run the spike harness before shipping there; `docs/linux-rendering-troubleshooting.md`. |
| `FileCard` restructure regresses the native download path | Medium | Keep `data-testid="file-card"`; e2e covers download. |
| Phase B live frame needs `allow-same-origin` to be useful | Medium | Separate decision, separate review (§8.6). |
| Users read A1's inert render as "the artifact is broken" | Low | A1 renders static content correctly; scripts are the only gap. Surface it in the panel when a `<script>` tag is present in the source. |
| Large artifact freezes the renderer | Low | 2 MiB preview cap (§7.1.6). |
