# Spike — Can the desktop webview render artifacts under the current CSP?

Status: **complete, blocking question answered**
Companion to: `docs/plan-artifact-preview.md` §4.4 / §6.0
Platform: macOS only (as scoped). Linux/WebKitGTK **not tested** — see §7.

## TL;DR

| Question | Answer |
|---|---|
| (a) `srcdoc` + inline script under the current CSP | **Blocked.** The frame is created and static HTML/SVG renders, but inline scripts never execute. Cause isolated: the frame inherits the app's `script-src 'self'`. |
| (b) `iframe src="http://localhost:PORT"` under the current CSP | **Blocked**, with an explicit `frame-src` violation. `frame-src` is absent and falls back to `default-src 'self'`. |
| (c) Fallback A — scoped CSP relaxation | Fully solves **Phase B**. Does **not** solve Phase A without touching `script-src`, which is out of bounds. |
| (c) Fallback B — `artifact://` custom protocol | Fully solves **Phase A**, including scripts, **without touching `script-src`**. Verified end to end. |
| (d) Recommendation | **Fallback B for Phase A, Fallback A for Phase B.** They are complementary, not competing. |

The plan's originally specified technique — `srcdoc` + `sandbox="allow-scripts"` — cannot
execute artifact JavaScript in this app under any CSP change that respects the
"never relax `script-src` globally" constraint. `docs/plan-artifact-preview.md` §6.1/§7
needs revising accordingly (§8 below).

---

## 1. Method

Measured against a **real WKWebView**, which is what Tauri 2.11.5 / wry 0.55.1 uses on
macOS — not Chromium, and not a theoretical reading of the CSP spec.

- A local HTTP server serves the test page with the **exact** CSP string from
  `desktop/src-tauri/tauri.conf.json`, sent as a `Content-Security-Policy` **response
  header** — the same delivery mechanism Tauri uses.
- A second server on another port plays the role of the agent's dev server.
- A small Swift harness hosts a `WKWebView`, registers a `WKScriptMessageHandler` to
  collect results, and takes a PNG snapshot of the rendered result.
- Each framed document reports back with `postMessage` (which works cross-origin, so it
  survives the opaque origin a sandboxed frame gets). "Did not report within the
  timeout" is read as "script did not run".
- The parent page listens for `securitypolicyviolation` and records every violation.

Harness source: `csp-spike/{server.py,harness.swift,harness2.swift}` in the session
scratchpad. It is throwaway — nothing was added to the repo.

### Environment

| | |
|---|---|
| macOS | 15.6.1 (24G90), arm64 |
| WebKit | Safari 18.6 engine |
| Tauri / wry | 2.11.5 / 0.55.1 (from `desktop/src-tauri/Cargo.lock`) |
| Swift | 6.1.2 |

### Fidelity caveats

These matter when reading the results, and none of them change the conclusions:

1. The harness is a standalone `WKWebView`, not the packaged Buzz app. It shares the
   engine and the CSP, not the full wry configuration.
2. The app document was served from `http://127.0.0.1:39001`; the real app runs on
   `tauri://localhost` (prod) or `http://localhost:29843` (dev). `'self'` semantics are
   equivalent for these tests, but the literal origin string differs.
3. The `artifact://` handler is a `WKURLSchemeHandler`. Tauri's
   `register_asynchronous_uri_scheme_protocol` is a wrapper over the same WebKit
   mechanism, so this is the right primitive — but it was not exercised *through* Tauri.
   **Confirm on the first real implementation.**

---

## 2. Test matrix and raw results

Four probes, run under four CSP variants:

- **T1** — `<iframe sandbox="allow-scripts" srcdoc="…<script>…">` (the plan's technique)
- **T2** — `<iframe sandbox="allow-scripts" src="http://127.0.0.1:39002/frame.html">`, framed page carries its own inline script
- **T3** — `<iframe sandbox="allow-scripts" src="artifact://local/a.html">`, served by a custom scheme handler
- **T4** — `<iframe sandbox="allow-scripts" srcdoc="…">` with **static markup only**, no script

| CSP variant | T1 srcdoc + script | T2 loopback | T3 `artifact://` | T4 static srcdoc |
|---|---|---|---|---|
| **baseline** (current `tauri.conf.json`) | did not run | **blocked** (`frame-src` violation on `http://127.0.0.1:39002`) | **blocked** (`frame-src` violation on `artifact://local`) | **renders** |
| baseline + `frame-src 'self'` | did not run | blocked | — | renders |
| baseline + `frame-src 'self' http://127.0.0.1:39002` | did not run | **loaded, own inline script ran, zero violations** | — | renders |
| baseline + `frame-src 'self' artifact:` | did not run | blocked | **loaded, own inline script ran, zero violations** | renders |

Raw output, baseline:

```
{"T1_srcdoc_inline_script":"BLOCKED_OR_NOT_RUN",
 "T2_loopback_iframe_own_inline_script":"BLOCKED_OR_NOT_RUN",
 "T3_artifact_scheme_own_inline_script":"BLOCKED_OR_NOT_RUN",
 "violations":[{"directive":"frame-src","blocked":"http://127.0.0.1:39002"},
               {"directive":"frame-src","blocked":"artifact://local"}]}
```

Raw output, `frame-src 'self' artifact:`:

```
{"T1_srcdoc_inline_script":"BLOCKED_OR_NOT_RUN",
 "T3_artifact_scheme_own_inline_script":{"ran":true, …},
 "violations":[{"directive":"frame-src","blocked":"http://127.0.0.1:39002"}]}
```

The PNG snapshot of the four frames confirms the rendering story visually: the two
script-bearing srcdoc/loopback frames are blank, while the `artifact://` frame paints
"ARTIFACT-SCHEME-RENDERED" and the static srcdoc frame paints
"STATIC-SRCDOC-RENDERED".

---

## 3. (a) `srcdoc` with an inline script — **blocked**

The inline script never executes under the current CSP.

The cause was isolated rather than assumed. Adding `frame-src 'self'` — which makes the
frame unambiguously permitted — **changes nothing**: T1 still does not run. So the
blocker is not frame creation. It is CSP inheritance: an `about:srcdoc` document
inherits the embedding document's policy, and the inherited `script-src 'self'` has no
`'unsafe-inline'`, so the artifact's own `<script>` is refused.

Two consequences worth stating plainly:

- **Static HTML and SVG do render.** T4 proves it, and the snapshot shows it. A
  static-only Phase A is genuinely shippable on `srcdoc` today, with no config change
  at all.
- **No CSP edit can fix T1 within the constraint.** The only directive that would let
  the inherited policy run inline script is `script-src 'unsafe-inline'`, which is
  global to the app document and explicitly out of bounds. `blob:` and `data:` URLs
  inherit policy the same way, so they are not escape hatches either. WebKit does not
  support the per-iframe `csp` attribute.

---

## 4. (b) `iframe src="http://localhost:PORT"` — **blocked**

Blocked, and the webview says exactly why:

```
{"directive":"frame-src","blocked":"http://127.0.0.1:39002"}
```

`tauri.conf.json` declares no `frame-src`, so it falls back through `child-src` to
`default-src 'self'`. A different port is a different origin, so the frame is refused
even in dev where the app itself runs on `localhost`.

Adding `frame-src 'self' http://127.0.0.1:39002` fixes it completely: the frame loads,
and — importantly — **the framed page's own inline script runs, with zero violations**.
A real cross-origin navigation gets its own CSP; it does not inherit the parent's. That
asymmetry with §3 is the key to the whole spike.

---

## 5. (c) Fallback evaluation

### Fallback A — minimal scoped CSP relaxation

Add a `frame-src` directive to `desktop/src-tauri/tauri.conf.json`, listing only what is
needed. No other directive changes; `script-src` untouched.

**Phase B: solves it completely.** Verified — frame loads, dev-server JS runs, HMR has
the same origin semantics it would in a browser tab.

**Phase A: does not solve it.** `frame-src` is irrelevant to the actual blocker (§3).

Security assessment: the honest read is that this is a real but narrow widening. It lets
the app frame **any** origin matched by the pattern. Scoped to loopback, the exposure is
"content already running on the user's own machine", which the user themself started. It
does not expose app data — the frame is still sandboxed to an opaque origin. The pattern
must be pinned to loopback hosts; a wildcard like `http:` would be indefensible.

Residual risk to name: a loopback frame *is* reachable by any local process bound to
that port, so the port number in the sentinel is trusted input. §6 of
`plan-artifact-preview.md` already requires an explicit user click, which is the right
mitigation.

### Fallback B — `artifact://` custom protocol on an isolated origin

Register a custom scheme, serve the artifact bytes from it, frame it, and allow only
that scheme in `frame-src`.

**Verified working, and the security posture is better than `srcdoc` would have been.**
Measured from inside the running artifact:

| Probe | Result |
|---|---|
| Inline script execution | **runs** |
| `document.origin` | `"null"` (opaque) |
| `parent.document` access | `SecurityError` |
| `localStorage` access | `SecurityError` |
| `document.cookie` | empty |
| `fetch()` to an external origin | **blocked** (`TypeError`) |

That last row is the finding that settles the recommendation. Because the artifact is a
real navigation, the protocol handler can attach **its own** response CSP:

```
Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline';
                         style-src 'unsafe-inline'; img-src data: blob:
```

and WebKit enforces it. The artifact's scripts run, and the artifact cannot phone home.
`'unsafe-inline'` here applies **only to the artifact document**, served by our own
handler — the app's `script-src` is never touched, satisfying the constraint literally
and in spirit.

By contrast, a `srcdoc` frame inherits the app's `connect-src`, which currently allows
`https: http: wss: ws:`. So if `srcdoc` scripts *could* run, they would have broader
network reach than the custom-protocol design. Fallback B is not a compromise forced by
the CSP — it is the stronger option.

Implementation is a copy of an existing, reviewed pattern in this repo:
`desktop/src-tauri/src/lib.rs:216` already registers
`register_asynchronous_uri_scheme_protocol("buzz-media", …)`, handled by
`desktop/src-tauri/src/media_proxy.rs:158` (`handle_buzz_media`, 311 lines for a
meaningfully harder job — it proxies, authenticates, and range-serves).

Design sketch:

1. Tauri command `stage_artifact(bytes) -> token` — holds artifact bytes in an
   `AppState` map behind a random opaque token, single-use or TTL-bounded.
2. `register_asynchronous_uri_scheme_protocol("artifact", …)` serves
   `artifact://localhost/{token}` with `Content-Type: text/html` (or `image/svg+xml`),
   `nosniff`, and the restrictive CSP above.
3. Frontend frames `artifact://localhost/{token}` with `sandbox="allow-scripts"`.
4. `tauri.conf.json` gains `frame-src 'self' artifact:` — one line, no `script-src` change.

Note the token indirection matters: without it, the scheme would need to accept a
caller-supplied path, which reintroduces a traversal/SSRF surface. Keep the bytes in
memory, keyed by a token the renderer never constructs itself.

### (d) Cost

Rough, and mine rather than measured — treat as sizing, not a commitment.

| Option | Scope | Estimate |
|---|---|---|
| **A — Phase B `frame-src`** | 1 line in `tauri.conf.json`; e2e test; security review of the pattern | **~0.5 day**, most of it review |
| **A — Phase A static-only** | No config change; ship `srcdoc` for static HTML/SVG, no JS | **0 extra**, but delivers a lesser feature |
| **B — `artifact://`** | New `src-tauri/src/artifact_protocol.rs` (~150–200 lines, modelled on `media_proxy.rs`); `stage_artifact` command + `AppState` token map; scheme registration (~8 lines in `lib.rs`); 1 line of CSP; Rust unit tests; frontend swap from `srcDoc` to `src` | **~2–3 days** including tests and review |

Fallback B is the larger cost, and it is where the security review effort should go —
the token lifecycle and the response headers are the parts worth arguing about.

---

## 6. (d) Recommendation

**Adopt both, for different phases. They do not compete.**

1. **Phase A → Fallback B (`artifact://`).** It is the only route that runs artifact
   JavaScript without relaxing the app's `script-src`, and it independently produces a
   *tighter* sandbox than the original `srcdoc` design (no network egress). Register the
   scheme, serve with a per-response CSP, keep `sandbox="allow-scripts"` on the frame as
   defence in depth.
2. **Phase B → Fallback A (`frame-src` + loopback).** There is no alternative: a live
   dev server must be framed by URL. Keep the pattern pinned to loopback hosts.
3. **Consider an interim ship.** Static HTML/SVG preview works *today* on `srcdoc` with
   zero configuration change. If the goal is to get the panel, the plumbing, and the UX
   in front of users early, Phase A can ship static-only first and gain script support
   when `artifact://` lands. This is a scoping decision for the team, not a technical
   constraint.

If only one thing is remembered from this spike: **the "just use srcdoc" instinct is
wrong here, and it fails silently.** The frame renders, the artifact looks fine, and
nothing works — with no error surfaced to the user. Any implementation that goes that
route needs a loud failure path.

---

## 7. Not covered

- **Linux / WebKitGTK.** Out of scope per the spike's remit, and it is the platform most
  likely to diverge — `docs/linux-rendering-troubleshooting.md` exists for a reason. Run
  the same harness before shipping to Linux users.
- **Windows / WebView2 (Chromium).** Untested. Chromium's CSP inheritance for `srcdoc`
  matches the spec, so T1 is expected to fail there too, but "expected" is not "verified".
- **The real Tauri protocol path.** §1 caveat 3 — verify on first implementation.
- **Artifact size and renderer stability** under large documents. Unrelated to CSP;
  `plan-artifact-preview.md` §7.6 already caps it.

---

## 8. Required follow-up edits to `plan-artifact-preview.md`

Not applied — Phase A code is gated on approval of this spike.

- §4.2 / §4.4 — replace the open question with these results.
- §6.1 — `ArtifactFrame.tsx` uses `src={artifact://…}`, not `srcDoc`. Keep
  `sandbox="allow-scripts"` and the no-`allow-same-origin` rule; both still apply.
- §6.1/§6.2 — add `desktop/src-tauri/src/artifact_protocol.rs`, the `stage_artifact`
  command, and the `lib.rs` registration to the new/modified file lists.
- §7 — insert the protocol work before the frame work; drop the "spike" step.
- §9 — add a test asserting the artifact response's CSP header, alongside the existing
  test on the `sandbox` attribute.
- §10 — retire the top CSP risk; add "token lifecycle in the artifact protocol" in its
  place.
