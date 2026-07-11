# 08 — Proposal engine

**Type:** AFK
**Blocked by:** 02 (card rendering builds on the block-renderer registry)
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Implementation Decisions › Propose→approve→commit* (incl. Card UX), *Module 3*, *Schema changes › agentProposals*

## What to build

The only path from agent intent to domain writes, end-to-end — proven in Wave 1 with a dev-seeded write agent so Wave 2 (Monthly Closing) lands on a tested engine.

Scope:
- `agentProposals` table (kind discriminated union — start with `createTask` and one destructive dev kind to exercise the confirm flow; payload, status pending|approved|discarded|failed, editedPayload, committedRef, decidedBy/At).
- "Write-intent" tool kind in the registry: creates a proposal record and returns its id — never touches domain tables.
- `proposal` block + card renderers: expanded cards with key fields inline-editable; per-card Approve + Discard; sticky "Approve all (N)" above the batch; destructive kinds require a confirm step even under Approve-all.
- `approveProposal(id, editedPayload?)` / `discardProposal(id)` / `approveAll(threadId)`: validate the (possibly edited) payload against **current** data, execute the mapped domain mutation as the caller, record outcome. Approved cards collapse to a compact committed row linking the created record; failed/stale cards show inline error + reason + Retry.
- Pending proposals persist across thread close/reopen; per-item outcomes on batch approve (no all-or-nothing rollback).
- Dev-seeded write agent ("Task Drafter" — dev-only) that proposes tasks from a pasted list, to exercise the whole flow.
- Vitest: payload validation + kind→mutation mapping (pure parts).

## Acceptance criteria

- [ ] The dev write agent, given "create 3 tasks: …", emits 3 expanded proposal cards; title/assignee/due-date are editable inline.
- [ ] Approving one card creates the real task as the approving user (activity log shows the human, not the agent) and the card collapses to a committed row linking the task.
- [ ] Approve all commits the rest; a destructive-kind card inside the batch still demands its confirm step.
- [ ] Discard marks the proposal discarded; nothing is written.
- [ ] Deleting a referenced project, then approving → the proposal fails validation with a clear reason; Retry after fixing works.
- [ ] A member approving an admin-only kind gets a clear permission error; the proposal stays pending.
- [ ] Closing and reopening the thread preserves pending cards.
- [ ] Validation + mapping covered by passing Vitest tests; `npx tsc --noEmit` clean.

## User stories addressed

- US 21 (writes only via proposals), US 22 (inline edit before approve), US 23 (per-item + approve-all), US 24 (executes with approver's permissions), US 25 (committed link), US 26 (stale validation), US 27 (permission error visible), US 28 (pending persists)
