"""The Tower Control assignments: the team ships its own visibility layer.

One place holds the briefs and their dependency order, so what the operator was
told the team would do and what the team was actually asked are the same text.

**The deliverable is a feature in the Buzz desktop app**, not a folder of
documents. Tower Control is a new sidebar section next to Pulse, Projects,
Agents and Workflows — the same kind of thing those are, built the same way,
behind the same `FeatureGate`. The `tower-control` channel and the NIP-MP
project are scaffolding that lets this team coordinate; nobody will ever use
them as the product.

That distinction was lost for a while and it cost real work: the design role
produced a self-contained HTML prototype and said so honestly
(`professional_acceptance: false` — the pilot gate validates a token dialect in
standalone HTML, not adoption of the desktop's own components). A prototype is
an input to the feature. It is not the feature.

The order is not ceremony. Product and the architect come first because they fix
what gets measured; strategy and innovation are deliberately scheduled *before*
any code, while changing our minds is still cheap — if the right answer is to
buy observability instead of building it, now is when that is cheap to learn.
The coder comes after the boundary exists, and the tester comes after there is
something real to exercise.
"""
CHANNEL = "55c3438a-e7e8-4d5c-acd9-6e066a8f178d"
PLAN = "docs/goals/tower-control-arranque.md"

SHARED = """Project: Tower Control — the control plane's visibility layer, shipped
as a feature inside the Buzz desktop app.

## What we are building

A new section in the Buzz desktop sidebar, alongside Pulse, Projects, Agents and
Workflows. It answers one question without interaction: what is the team of
agents doing right now, is it going well, and does it need me?

The feature lives in `desktop/` (Tauri 2 + React 19 + Tailwind, Biome for lint
and format). The navigation entries are declared in
`desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx`, and Pulse,
Projects and Workflows are each wrapped in `<FeatureGate feature="...">` — the
mechanism Buzz already has for landing a new section and turning it on
progressively. Tower Control follows that pattern. Do not invent a new one.

## What is NOT the deliverable

The `tower-control` channel and the NIP-MP project are scaffolding for this
team's own coordination. A document, a diagram or a standalone HTML prototype is
an input to the feature — useful, and not the thing being delivered. Work is
done when it is code in `desktop/`, reviewed, and exercised in the running app.

## Work already done, to build on rather than repeat

Readable with the `read` tool:
  tower/plan-arranque.md      startup plan: decisions, steps, tests
  tower/plan-contexto.md      long context: existing kinds, OTel state
  tower/vision-actividad.md   presentation criterion (verb, object, outcome)
  tower/fila-cartera.html     a verified single portfolio row, four switchable
                              states. Its own report declares its limit: it is
                              standalone HTML, not a React component using the
                              desktop's design system. Treat it as a
                              specification of behaviour, not as source to paste.

Files are long: `read` takes `offset`/`limit` and truncates; follow
`next_offset` if you need the rest. Read only what your assignment needs.

## Standing constraints

These are decided. They do not reopen without new evidence.

- The source of truth is the OpenTelemetry span. Nostr events are a derived
  projection. Chosen for portability: migrating must cost one adapter.
- Cost is owner-scoped, and every aggregate travels with its coverage.
- run.id = trace_id. There is no correspondence table.
- All inference goes to one model combo.

## The open problem at the centre

`run.status = blocked` is declared "derived" in `tower/plan-arranque.md` §2 with
**no mechanical producer assigned**, while the acceptance criterion requires the
portfolio to show without interaction that something is stuck. The design role
found this and modelled it as a marked inference rather than a fact, which was
the honest thing to do and is not a fix. Nobody produces that datum today.

A status that cannot distinguish "the agent could not do it" from "the tool
would not let it" is worth very little — we learned that on ourselves this week,
when three assignments were burned by a gate that rejected without saying what
was allowed.

If you believe a constraint above is wrong, say so in your first two sentences
with the reason, and do the assignment anyway under the standing assumption."""

ASSIGNMENTS = {
    "producto": {
        "identity": "product",
        "depends_on": [],
        "brief": """Fix the problem and the acceptance criteria for the Tower Control feature.

What does an engineering director decide looking at this section that they cannot
decide today, and what evidence do they need to decide it? Separate what the
portfolio view settles from what only the drill-down settles.

Deliver: problem, outcome, and measurable acceptance criteria for the first
shipped slice — the one that goes behind the `FeatureGate` and can be turned on.
State explicitly what is out of scope. If the baseline is unknown, say so and
propose how to measure it first rather than inventing it.

Decide one thing the team cannot decide for you: what the first version must
show to be useful on day one. Earlier work assumed a portfolio of work lines;
confirm that or replace it, and say why.""",
    },
    "arquitecto": {
        "identity": "architect",
        "depends_on": ["producto"],
        "brief": """Read-only. Answer with evidence from files, not opinion.

1. Where does Tower Control's state live, and how does the section get its data?
   Read `desktop/src/features/pulse/` and
   `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx`. Say what the
   Pulse pattern gives us for free and where it does not fit.

2. Define the `TowerSource` port: which operations it exposes, which neutral
   domain types, and what is explicitly outside it. The test is that the UI
   cannot tell whether Buzz or an OTel backend is behind it.

3. `run.status = blocked` has no producer. Decide where it comes from: which
   span or event carries it, who writes it, and how the UI distinguishes an
   observed block from an inferred one. This is the blocking decision for the
   whole feature — do not defer it.

Also name what the product lacks that this needs. One is already known: there is
no way to publish an arbitrary kind from the CLI, so the Nostr projection needs
a new `buzz-cli` subcommand. Verify that and find the others.""",
    },
    "research": {
        "identity": "research",
        "depends_on": [],
        "brief": """Conventions and prior art, from primary sources.

1. State of the OpenTelemetry `gen_ai.*` and `mcp.*` semantic conventions: what
   is stable, what is still experimental, and which names we use today that could
   change. Our module is `tower/telemetry.py`, readable with `read`.

2. How products that already ship agent observability solve it. What they put in
   the portfolio view versus the detail view, and specifically how they represent
   a stalled or blocked run — that is our open problem.

Say plainly when the field does not know. Label anything read only as an
abstract.""",
    },
    "estrategia": {
        "identity": "strategy",
        "depends_on": ["producto"],
        "brief": """Is building this layer the right call?

Compare building, buying finished observability, and doing nothing. Include the
economics: what a layer of our own costs to maintain against what it returns.
Recommend one choice with its sequence and the falsifiers that would make you
withdraw it.

Now is when changing our minds is cheap. If the answer is buy, say so.""",
    },
    "innovacion": {
        "identity": "innovation",
        "depends_on": ["producto"],
        "brief": """The option nobody asked for.

With traces of what the agents actually do, what becomes possible that we are not
even considering? Generate hypotheses materially different from "a screen to look
at", not variations of one. Prioritise by learning value and design the cheapest
experiment that discriminates between them, with abandonment thresholds fixed
before it runs.""",
    },
    "analista": {
        "identity": "analyst",
        "depends_on": ["producto"],
        "brief": """Which numbers are honest on this screen.

For every figure Tower Control shows: denominator, population, time window, and
what cannot be claimed with it. Pay particular attention to cost: it is
owner-scoped, so a project total can be an undercount that looks complete.

Deliver the presentation rule: when a figure is shown, when it is shown with a
coverage warning, and when it must not be shown at all.""",
    },
    "diseno": {
        "identity": "designer",
        "depends_on": ["producto", "analista"],
        "brief": """Specify the section's interface, for a React implementation.

One row per work line, answering without interaction: what is happening, is it
going well or stuck, and does it need the operator. The criterion is verb,
object, outcome.

`tower/fila-cartera.html` already settles the row's four states (data, loading,
empty, error) and was verified rendering. Do not rebuild it. Your work now is
what it does not cover: the section as a whole — its empty state before any run
exists, its error state when the source is unreachable, keyboard and focus order
across the list, and how a blocked line is distinguished from a quiet one.

Deliver a specification a coder can implement in React against the desktop's own
components, naming the component for each element rather than describing it in
prose. Say explicitly which parts you could not settle without seeing it run.""",
    },
    "coder": {
        "identity": "coder",
        "depends_on": ["arquitecto", "diseno"],
        "brief": """Ship the smallest Tower Control slice that can be turned on.

In `desktop/`, following the Pulse pattern: a `FeatureGate`-wrapped navigation
entry in `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx`, a feature
module under `desktop/src/features/`, and the portfolio view behind it.

Constraints that are not negotiable, from the repository's own guidance:
- Text sizes use rem-based Tailwind tokens, never arbitrary px or rem literals.
  `pnpm check:px-text` fails the build otherwise.
- Match the surrounding code: naming, error handling, test style, comment
  density. The conventions of the code you are editing outrank your defaults.
- Do not push, merge, open a pull request or deploy. Producing the change is the
  deliverable; shipping it is not.

Deliver the smallest thing that renders real data end to end, with its tests. If
the architect's port is not settled, implement against it anyway and say exactly
where you had to assume. List what you left out and why.""",
    },
    "revisor": {
        "identity": "reviewer",
        "depends_on": ["coder"],
        "brief": """Derive the risks from the requirement before reading anyone's conclusions.

The requirement: a portable visibility layer where migrating from Buzz to another
OTel backend costs one adapter. Enumerate how that can fail in practice and what
test would detect each failure.

Then, and only then, review what the coder delivered. Run the tests, do not read
them. Check specifically that a guard's removal fails a test — a regression test
bound to a test-only helper protects nothing.

Say what you did NOT exercise.""",
    },
    "probador": {
        "identity": "tester",
        "depends_on": ["coder"],
        "brief": """Use the feature as the operator would, and measure what it is worth.

Not "does it render" — whether it answers the question it exists to answer. Open
the running app, go to the section, and try to settle something real: which work
line is stuck, and what would you do next.

Report friction as evidence, with the exact step where it appeared. A question
you could not answer is a finding, not a failure of yours. Where a number is
shown without its coverage, or a blocked line is indistinguishable from a quiet
one, say so with the screenshot.

Your `buzz` access is read-only by design: a tester that changes the system
changes what it is measuring.""",
    },
}

ORDER = ["producto", "research", "arquitecto", "estrategia", "innovacion",
         "analista", "diseno", "coder", "revisor", "probador"]


# Where the project documents live differs by harness, and getting this wrong is
# expensive: the shared frame used to tell every teammate that its `read` could
# not reach the repository, while the architect's own brief asked it to look at
# `desktop/src/features/pulse/`. Told it could not do the one thing it was asked
# to do, it spent its whole 900-second window and returned nothing.
SCOPE_HERMES = """Paths are relative to your artifacts; your `read` does not reach
the repository. If you need something from the code, ask a teammate on the code
plane for it."""

SCOPE_PI = """Paths under `tower/...` are relative to your artifacts. Every other
path is relative to the repository, which you can read: you are working inside
it."""


def brief_for(role: str) -> str:
    """The full text one teammate receives: shared frame plus its own brief."""
    from control_plane.roster import CONTRACTS, PI

    scope = SCOPE_PI if CONTRACTS[role]["harness"] == PI else SCOPE_HERMES
    return SHARED + "\n\n" + scope + "\n\n---\n\n" + ASSIGNMENTS[role]["brief"]


def ready(role: str, done: set[str]) -> bool:
    return all(d in done for d in ASSIGNMENTS[role]["depends_on"])
