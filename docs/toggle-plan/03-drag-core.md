# Slice 3 — Drag core: move, reassign, unschedule

**Type:** HITL — ends with a drag-feel review · **Blocked by:** [Slice 2](02-read-only-grid.md) · **Status:** ✅ approved (2026-07-05)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Backend API* (updateSegment, removeSegment), *Frontend* (drag engine), *Module Design* (planner drag engine), *Further Notes* (design provenance — the single-snapped-visual ruling).

## What to build

The first plan mutations, driven by the custom pointer-event drag engine.

- **Mutations:** `updateSegment` (dates and/or userId) and `removeSegment`, admin-gated via the existing `requireAdmin` helper, org-ownership validated, date invariant enforced. Tested.
- **Drag engine hook** (deep module — all pointer complexity lives here; components only render its state):
  - Move: drag a bar horizontally/vertically; **one solid preview bar snaps day-by-day** (the original hides during the drag). Never a detached outline plus a separate free-moving fill — this was explicitly rejected in design review.
  - Reassign: vertical drag onto another person's row is the same gesture.
  - Live lane reflow: affected rows re-pack lanes during the drag with a short animated transition; no overlap is ever shown; row heights adjust live.
  - 4px movement threshold separates click (selection) from drag.
  - Commit on release via optimistic update; rollback + error toast on failure. Escape/pointercancel cancels cleanly.
- Selection: click selects a bar (ring in the bar's category color); Delete/Backspace unschedules the selected segment (admin only); Escape deselects.
- **Read-only enforcement:** non-admin members get no drag affordances, no cursor changes, no selection-delete; server rejects their mutations regardless (tested).
- The pure placement reducer (pointer position + grab offset + mode → proposed placement) is unit tested.

**Demo:** drag a bar across days and rows with live reflow, drop it, refresh — it stayed. Kill the network, drag, watch it roll back with a toast. Sign in as a member — the board is inert.

## Acceptance criteria

- [x] `updateSegment` / `removeSegment` reject non-admins, cross-org ids, and `endDate < startDate` (verified by tests)
- [x] Moving a bar shows exactly one snapped solid preview; the drop lands exactly where the preview showed
- [x] Vertical drag reassigns to another person's row
- [x] Neighbouring bars reflow into lanes live during the drag, animated; overlap is never rendered
- [x] Click (< 4px movement) selects and does not move; Delete removes the selected segment; Escape deselects
- [x] Mutations are optimistic with rollback + `toastError` on failure (per app convention: no fire-and-forget)
- [x] Members see a read-only board (no handles, no grab cursors) and the server independently rejects their writes
- [x] Placement reducer unit tests pass; `npx tsc --noEmit` clean; backlog.md entry written
- [x] **HITL stop:** the user test-drove the drag feel and approved (2026-07-05)

## User stories addressed

15, 17, 18, 20, 21, 22

## Notes

If the custom engine stalls, `dnd-timeline` (headless, dnd-kit-based) is the approved fallback — fetch current docs via Context7 before adopting it. The already-installed `motion` package may be used for reflow/settle animation.
