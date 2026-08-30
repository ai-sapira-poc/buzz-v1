# Backlog — real sidecars in local builds

Shipped alongside the build-identity work, and deliberately left undone.

## The problem

`just desktop-release-build` creates the six sidecars with `touch` so the
bundler has something to embed; CI replaces them with real binaries. A local
build therefore ships zero-byte sidecars, and every agent feature fails at the
moment of use with an error that reads like a product bug rather than a build
one.

## What shipped instead

A startup warning naming the stubbed sidecars
(`desktop/src/shared/hooks/useStubbedSidecarWarning.ts`, backed by
`get_sidecar_health`). It costs nothing and removes the confusion, which was
most of the damage.

## What was deferred, and why

Compiling the six sidecars for real on every local build costs **15–25 minutes**
and several GB of `target/`. That is a poor trade for the common case: most
local builds are made to look at the UI, not to drive agents.

Worth revisiting if either changes:

- Local agent work becomes routine rather than occasional.
- A cheaper path appears — a cached prebuilt set keyed by workspace revision,
  or a `just desktop-release-build --with-sidecars` opt-in that developers
  reach for only when they need it. The opt-in is the smaller change and is
  probably where this should start.

Whoever picks this up: the stub detection already knows which sidecars are
placeholders, so a build mode that fills them in has a ready-made verification.

---

# Method note: `strings` is not evidence of absence in a release binary

Twice in one day, verifying a build, `strings` reported something missing that
was present. Both would have become a wrong conclusion stated with confidence.

**`get_sidecar_health`.** `strings | grep` found zero occurrences while
`get_build_info` showed one, which looked exactly like an unregistered Tauri
command. It was registered (`lib.rs`), and `grep -a` on the raw bytes found it.

**The baked build timestamp.** No epoch appeared in `strings` output at all.
`env!("BUZZ_BUILD_TIME").parse()` is folded by LLVM in release, so the string
literal does not survive into the binary — only the integer does. Searching for
a string that the optimiser deleted can never succeed.

The general shape: `strings` samples printable runs subject to length and
encoding heuristics, and release optimisation deletes, merges and re-encodes
literals. A hit proves presence; a miss proves nothing.

Use instead, in order of directness:

1. **`target/<triple>/<profile>/build/<crate>-*/output`** — what the build
   script actually emitted, verbatim. This is the source of truth for anything
   `build.rs` bakes in, including the commit and timestamp of a build.
2. **`grep -a` on the binary** for names that must survive as data (Tauri
   command names, JSON keys).
3. **The built frontend bundle** (`desktop/dist/assets/*.js`) for anything
   renderer-side. Object keys and test ids are not minified, so they are
   reliable there.

And the habit worth keeping: when a check says a feature is missing from a build
you just made, suspect the check before the build.
