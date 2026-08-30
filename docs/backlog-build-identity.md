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
