"""The Live Runs goal: a visual map of what the team is doing, inside Tower Control.

This project is deliberately shaped differently from `tower_project`. There the
slices were cut by a human and handed to each role already sized. Here the goal
arrives whole, addressed to the maestro, and cutting it is part of the work.

That is not a demo trick. Assignment size is the strongest predictor of failure
we can measure before spending anything: over 215 finished assignments in this
pilot, under 1500 characters about one in ten fails, and over 3000 characters
seven in ten do. `capabilities.delegate` refuses past that line and names the
two ways forward. This brief is over it on purpose, so the first thing the
system does with the goal is decide how to break it.

The producer half of the loop landed before this project opened: the six job
kinds are published, the relay accepts them, and Tower's adapter folds them
into lines. What does not exist is a way to *see* the shape of the work — who
is working on what, and how the pieces relate.
"""

CHANNEL = "55c3438a-e7e8-4d5c-acd9-6e066a8f178d"

SHARED = """Project: Live Runs — a visual map of the team's work, as a view inside Tower Control.

## The goal, in one sentence

A person opening Tower Control should be able to look at a picture and answer
three questions without reading a list: which agents are working right now, what
they are working on, and how those pieces of work relate to each other.

## What already exists, verified

These are facts from the repository and the pilot database, not assumptions. You
are expected to check them rather than trust this list, and to report any that is
wrong. Several of them landed in the last day, so a stale memory of this codebase
will be wrong.

- `crates/buzz-core/src/kind.rs` defines the six job lifecycle kinds: 43001 job
  request, 43002 job accepted, 43003 job progress, 43004 job result, 43005 job
  cancel, 43006 job error.
- `crates/buzz-relay/src/handlers/ingest.rs` now maps all six to
  `Scope::MessagesWrite`. Before that they were refused as an unknown kind, so
  any memory of "the relay rejects these" is out of date.
- `crates/buzz-cli/src/commands/jobs.rs` publishes them:
  `buzz jobs publish --state <requested|accepted|progress|result|cancelled|error>
  --job <id> --owner <hex> [--channel] [--role] [--trace] [--content]`.
  Tags carried: `p` owner, `job` correlation id, `h` channel, `role`, `trace`.
- `experiments/buzz-autonomy/operator_updates.py` emits one such event per job
  transition, alongside the human-readable message it already published.
- `desktop/src/shared/api/towerJobFold.ts` folds those events into portfolio
  lines. The state comes from the kind, never from the content. It is a pure
  function with no React and no relay in it, and it has tests.
- `desktop/src/shared/api/towerBuzzSource.ts` queries the six kinds scoped by
  `#p` on the owner and returns those lines.
- `desktop/src/features/tower/domain/TowerSource.ts` is the portability port.
  Its contract: a failure must reject, never resolve to an empty array, because
  an empty array is a successful read meaning "no lines".
- Tower Control ships behind `FeatureGate feature="tower"`, route `/tower`, with
  a sidebar entry. Its states are honest: it renders "No readable signal",
  "silence is not inactivity" and "Unknown" rather than faking a zero.

## Standing constraints

These are decided and do not reopen without new evidence.

- Prefer a Nostr event over a new HTTP endpoint. The kinds you need already
  exist, so there is likely nothing to add to `buzz-core`.
- Relay queries must name their kinds explicitly, or the p-gate refuses them.
- Channel scoping uses `h` tags, not `e` tags.
- The UI must not learn about Relay, Nostr or kind numbers. That translation
  lives in the adapter, and `towerPortIsolation.test.mjs` fails if the boundary
  leaks. A graph view is still UI: it consumes the domain model, not events.
- Text sizes use rem-based Tailwind tokens. `pnpm check:px-text` fails the build
  on an arbitrary literal, px or rem. This applies to any label you draw.
- No new heavyweight dependency without justifying it against what the repo
  already has. A graph you can render with existing primitives beats one that
  adds a rendering library to the bundle for a single view.
- No push, no pull request, no deploy. Producing the change is the deliverable;
  shipping it is not.
- Do not invent a status. If the data cannot distinguish blocked from quiet, the
  surface says so, exactly as it does today.

## Definition of done, per slice

Work closes in three gates on every slice, never as three phases of the project.
90% is the path working end to end with tests. 7% is the edge cases and
integration gaps, each enumerated one getting a test and the uncovered ones said
out loud. 3% is the operator's experience: loading, empty and error state on
every new surface. An empty state with no text is the worst of all, because the
operator cannot tell "nothing here" from "it broke" from "still looking"."""

GOAL = """Add a view to Tower Control that shows the state of the team as a picture.

Acceptance for the goal as a whole: with agents running in this pilot, a person
opening this view sees each agent and each unit of work as a node, sees the
relationship between them as an edge, and can tell at a glance which nodes are
active, which finished and which failed. Selecting a node tells them more without
leaving the view. When there is no work, the view explains what it shows and may
illustrate it with an example clearly marked as such, rather than drawing an
empty canvas. When the source cannot be read, it says that instead of drawing
nothing, which looks identical to calm.

What the data can currently support, and what it cannot:

- Each job event carries a `job` id, a `role`, an owner and optionally a channel
  and a trace. So agent-to-work edges are directly available.
- Work-to-work relationships are NOT in the event stream today. The control
  plane knows them (`pilot.py` holds a dependency graph, including
  `dependency_substitutions`), but nothing publishes them. Whether to extend the
  producer or to scope the first slice to what is already published is a real
  decision and it is yours to make and to justify.
- There is no position, no layout and no clustering anywhere. Layout is
  computation you will have to define, and it should be deterministic: a graph
  that reshuffles itself on every refresh is unreadable.
- `run.status = blocked` still has no mechanical producer. Do not invent one,
  and do not let a node's appearance imply a blockage nobody observed.

There is one more surface, and it is not an afterthought: **the view with no data
in it**. Today's most likely first impression of this screen is an empty one,
because a relay that has not yet been updated accepts no job events at all. An
empty canvas would make a working screen look broken and a broken one look calm,
which is the single worst outcome this project can produce.

So the no-data case is a designed surface, not a fallback. It explains what this
view shows, and it may illustrate that with an example graph so a first-time
viewer understands the shape of what will appear. Two hard constraints on that
illustration, and they are not negotiable:

- It must be unmistakably labelled as an example. A person must never be able to
  mistake demonstration nodes for agents that are really working. If a label can
  be missed at a glance, the illustration is wrong.
- It must not collapse the three distinct states into one. "No work yet",
  "cannot read the source" and "still loading" are different facts and stay
  visibly different. An error must never render as a friendly illustrated
  emptiness, which would hide exactly the failure the operator needs to see.

Those points are a sketch of the terrain, not an instruction for how to cross it.
If the evidence says the seams are elsewhere, say so in your first two sentences
and cut it your way.

What must not happen: three pieces started and none closed. One slice a person
can watch working is worth more than three half-wired ones, and the last 10% of
each routinely costs as much as the first 90%, so budget it as such and never
call it small. If the honest first slice is a static picture of real data with no
live updates, that is a better first slice than a live one that renders nothing.

Two things are explicitly out of scope. The OpenTelemetry span remains the source
of truth for depth and is not replaced; this is the readable realtime projection
next to it. And this view does not replace the existing Tower list: it is another
way to look at the same domain model, and if you find yourself needing a second
source of truth to draw it, stop and say so."""

ASSIGNMENTS = {
    "maestro": {
        "identity": "maestro",
        "depends_on": [],
        "brief": GOAL,
    },
}


def brief_for(role: str) -> str:
    """The full text one teammate receives: shared frame plus its own brief."""
    return SHARED + "\n\n---\n\n" + ASSIGNMENTS[role]["brief"]


def ready(role: str, done: set[str]) -> bool:
    return all(d in done for d in ASSIGNMENTS[role]["depends_on"])
