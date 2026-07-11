# 11 — Permissions, audit & hardening

**Type:** AFK
**Blocked by:** 02, 05, 06, 07, 08, 09, 10 — closes Wave 1
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Permissions/visibility decisions*, *US 51–54*, *Testing Decisions › Acceptance checklist*

## What to build

The closing sweep that turns the assembled platform into a shippable V1: visibility rules verified everywhere, the admin audit view, and the full PRD acceptance checklist run.

Scope:
- **Visibility enforcement pass:** members see only runnable agents and only their own threads (rail, queries, artifacts, proposals — server-enforced); thread ownership checked on every thread-scoped query/mutation.
- **Admin audit view:** all org threads/runs in a table (who, agent, started/finished, status, token usage), URL-persisted filters (agent / user / status / date range) per repo convention; opens any thread read-only.
- **Run accounting:** `agentRuns` complete (tokens, timings, outcome) and surfaced in the audit view.
- **Error-handling sweep:** every mutation `.catch(toastError)`; runner failure paths re-verified (key missing, tool throw, cancel, stale proposal).
- **Polish finale:** content-aware skeletons and dedicated empty states on every workspace surface; loading → empty → content order everywhere; no pills/bordered cards anywhere in the stream (final no-slop pass).
- **Acceptance run:** execute the PRD's V1 acceptance checklist end-to-end and record results; update `docs/backlog.md` with the Wave 1 section (task checkboxes, verification, deferred TODOs: Gmail/Task Creator → Wave 3, Monthly Closing → Wave 2, scheduling → Wave 4, pdf extraction if deferred, voice/slash/queueing/rename per Out of Scope).

## Acceptance criteria

- [ ] A member account: sees only permitted agents, only own threads; direct URL access to another user's thread is denied server-side.
- [ ] Admin audit view lists all org runs with working URL-persisted filters and opens any thread.
- [ ] Every run has complete accounting (user, agent, timings, tokens, outcome).
- [ ] Grep-level sweep confirms no un-handled mutation and no stream-level pill/bordered-card regressions.
- [ ] The PRD's full acceptance checklist passes, including: timesheet cells equal deterministic queries; CSV matches; AI output contains no model-produced number; orgId scoping everywhere.
- [ ] `docs/backlog.md` updated per repo convention; `npx tsc --noEmit` clean; all Vitest suites green.

## User stories addressed

- US 6 (members see only permitted agents), US 51 (own threads), US 52 (admin audit view), US 54 (run accounting)
