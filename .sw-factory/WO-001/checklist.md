<!--lint disable no-undefined-references strong-marker-->

# Work Order Execution Checklist: WO-001

**Work Order Number:** WO-001
**Work Order Title:** Tower Control community POC
**Initialized At (UTC):** 2026-09-15T12:51:25Z

## Phase 1: Start / Context Gathering

### Required Steps

- [x] Review work order description from the user and persist it in `work-order.md`; no Software Factory MCP is configured.
- [x] Identify linked requirements and blueprints in the repository plan.
- [x] Review every connected requirements document: `docs/goals/tower-control-plan.md` and `docs/goals/tower-control-arranque.md`.
- [x] Review every connected blueprint document: `VISION.md`, `VISION_PROJECTS.md` and `crates/buzz-core/src/kind.rs`.
- [x] Follow linked references relevant to the slice; no additional external blueprint records were available.
- [x] Review referenced blueprint material and record it in `context.md`.
- [x] Extract acceptance criteria into `work-order.md` as `REQ-TOWER-POC-*` and `COV_TOWER_*`.
- [x] Identify the architecture path: neutral Tower domain → `TowerSource` → Buzz adapter → gated desktop UI.
- [x] Update `context.md` with `update-context-index.sh`; branch and delivery links are recorded.

- [x] **Certification: Phase 1 complete. Proceeding to Phase 2.** Context and plan are recorded before implementation.

## Phase 2: Planning And Implementation

### Implementation Plan

(see `execution/writing-implementation-plans.md`)

- [x] Implementation plan documented in `implementation-plan.md`.
- [x] Testing section documented in `implementation-plan.md`.

**Progress note:** the first launcher run was stopped after an unbounded Pi
process exceeded its 30-minute limit and tried to continue toward `coder` without
an architecture handoff. The launcher now records both harnesses durably. A
second, bounded 5-minute architecture run published `started` and `failed` to
the configured community channel; `coder` was then explicitly published as
`blocked`. No Railway or Git publish was performed. The stale local fleet was
then replaced with long-lived agents on the Tower Control channel; the three
failed children were requeued as attempt 2 and the architect is currently
`running` with an operator update and heartbeat.

### Implementation

- [x] Implemented changes are scoped to the Work Order (launcher lifecycle, long-running execution, and operator communication)
- [x] Tests added or updated for changed behavior (`test_tower_project.py`)
- [x] Documentation, generated files, fixtures, migrations, or config updated where relevant (`implementation-plan.md`, `learnings.md`)

### Evidence captured during implementation

- `python3 -m unittest discover -s experiments/buzz-autonomy -p 'test_*.py'` — 174 tests, exit 0.
- `tower-arquitecto` — `running` with `trace_id`, heartbeats every 30 seconds, then durable `failed` after the bounded 300-second Pi timeout; Buzz receipt accepted.
- `tower-coder` — durable `assignment_blocked` because `arquitecto` and `diseno` were not done; Buzz receipt accepted.
- `http://localhost:3000/health` — `ok`.
- `serve.py --status --roles maestro,producto,research,arquitecto` — four agents listening on the Tower Control channel after restart; new ACP processes show `max-turn=604800` and `idle-timeout=604700`.
- `native-19ff35e42381161defce49403d7bb121e0c8866f` — three prior failures requeued as attempt 2; `arq-tower-frontier-verify` is `running`, with `operator_update`, `trace_opened` and `assignment_heartbeat` recorded. The design and review jobs remain queued behind the ordered driver; `coder-tower-slice1-implementation` is queued behind all three and has an explicit operator-visible dependency wait.
- The live Pi checkpoint exposed an unbounded recursive shell search; only that
  command group was terminated, while the Pi session, job and checkpoint were
  retained. Pi roles now load `pi_command_guard.ts`, which gives each bash
  command a finite default without imposing a short model-turn lifetime.
- Restarting listeners exposed orphaned nested `buzz-acp` sessions. The old
  generation was removed by explicit process group, and `serve.py --stop` now
  walks descendants and terminates nested sessions before removing its PID file.
- Operator-facing diagnostic — accepted by the Railway relay as event `97da65bd6562a19413b28fea6a78464ab76ab6b7ea1c6873750b85f857e64536`; read back successfully from the Tower Control channel.
- Desktop Tower UI and the full feature slice remain pending; Phase 2 is not certified complete.

- [ ] **Certification: Phase 2 complete. Proceeding to Phase 3.**

## Phase 3: Review And Verification

### Review

- [ ] Review subagent spawned per `execution/review-phase.md` and returned a verdict
- [ ] All acceptance criteria from the Work Order and linked requirements are satisfied
- [ ] Architecture is aligned with linked blueprints, or documented drift is accepted
- [ ] Exploratory pass on user-visible or external behavior — not only automated tests; for browser apps, use browser-based testing if available. Brief notes in `review-log.md` or evidence.
- [ ] Latest `review-log.md` verdict is `APPROVED`

- [ ] **Certification: Phase 3 complete. Proceeding to Final Completion.**

## Final Completion Check

- [ ] All phase certifications above are complete
- [ ] Checklist is fully filled out with evidence
- [ ] Review log is complete (`review-log.md`)
- [ ] Implementation plan was followed (`implementation-plan.md`)
- [ ] All intended files are present in the working tree
- [ ] Work order status updated to `in_review`
