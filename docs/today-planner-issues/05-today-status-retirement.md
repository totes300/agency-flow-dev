# 05 — Today status retirement + seed + docs

**Type**: AFK
**Blocked by**: 01 (the derived Today group must exist before the status disappears)
**Unblocks**: —

## Parent PRD

[`docs/today-planner-prd.md`](../today-planner-prd.md) — § Implementation Decisions (status seed change, no data migration), § User Stories 23–26

## What to build

The status system stops naming time: **"Today" leaves the default seed, "Next up" is the triage destination, and the dev environment is reset by hand — no migration code.** Plus the documentation duties that close the feature.

### Schema

- None.

### Backend (Convex)

- `DEFAULT_STATUSES` in `convex/lib/constants.ts`: remove `{ name: "Today", type: "backlog", ... }`; re-number `sortOrder` so the seed reads Inbox → Next up → In progress → Admin review → Client review → Stuck → Done.
- Verify the seeding path (`convex/statuses.ts` seed loop) needs no other change.
- Verify (no code expected): `resolveVisibleStatusIds` fallback chain tolerates a deleted status ID in `todayVisibleStatuses` / `defaultMyTasksStatusIds` — filter → org default → first in_progress. This is the guarantee that manual deletion can't blank anyone's My Tasks.

### Dev data (manual, documented in the PR description)

- Either reset the dev deployment data and re-onboard (new seed applies), **or** delete the "Today" status in Settings → Statuses and re-status its demo tasks to Next up by hand. No migration script — deliberate, PRD-recorded decision.

### Frontend

- None expected. Sweep for any hardcoded reference to a status named "Today" (copy, defaults, tests) and remove.

### Docs

- `docs/backlog.md`: add the Today × Planner phase entry — task-level checkboxes for all six slices, verification section, "TODOs deferred" list (cross-group drag, due-today toggle, Upcoming group, plan-vs-actual reporting, per-row shortcut — per PRD Out of Scope).
- Confirm the superseded banner on `docs/today-tab-prd.md` (already in place) and cross-link from the backlog entry.

### Tests

- Seed shape test if one exists for `DEFAULT_STATUSES`; otherwise the helper tests from 01 already cover fallback behaviour with dangling IDs — extend `myTasks` helper tests with a "preference references a deleted status" case if not present.

## Acceptance criteria

- [ ] A freshly onboarded org has no "Today" status; first in_progress status ("Next up") is the My Tasks visible-group default via the existing fallback.
- [ ] After deleting the "Today" status in the dev org, My Tasks renders correctly for users whose saved preference referenced it (fallback chain, no blank view).
- [ ] Grep confirms no remaining code/copy references a "Today" **status** (the Today group naming is unaffected).
- [ ] `docs/backlog.md` entry exists with checkboxes, verification, and deferred-TODOs sections.
- [ ] `npx tsc --noEmit` 0 errors.

## User stories addressed

23–26
