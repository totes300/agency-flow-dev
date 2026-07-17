# 04 — Review checklist (flags callout)

## Parent PRD

`docs/prd-month-close.md` — sections: Implementation Decisions (Review checklist v1 flag set),
UX Decisions (states, data display), Module Design (`closeFlags`).

## What to build

The gray callout above the entries table that turns closing into a finite checklist. Demo: the
Arlow June close shows "3 things to review"; fixing an entry clears its flag live; when everything
is fixed the callout flips to "All clear — ready to close."

- Wire `closeFlags` output into a callout: warnings first (missing note, ≥ 8h entry, running timer,
  missing overage rate with a "Set rate" link to project settings), then informational carried
  lines.
- Each item jumps to and briefly highlights its entry row.
- Majority-carried promotion: when a task group is mostly carried entries, the shared "carried ·
  <month>" label renders once in the group header instead of per row.

## Acceptance criteria

- [x] Callout renders all v1 flags with correct severity presentation (warnings amber `TriangleAlert`;
      blocking red `CircleAlert` + "Set rate" link; carried lines muted dot/informational).
- [x] Clicking an item scrolls to (`scrollIntoView`) and flash-highlights (amber bg, 1.6s) the
      target row via a stable DOM id (`CLOSE_ENTRY_DOM_ID`).
- [x] Flags resolve live as edits fix them; the "All clear — ready to close" state (green
      `CheckCircle2`) appears when no warning/blocker remains. Browser-verified: 3→2 (reduced the
      long entry) → All clear (added the two missing notes); info lines would persist.
- [x] Running-timer flag is warning-only (`loadRunningTimers` date-gated to the period; never a
      blocker — commit behaviour is slice 06).
- [x] Majority-carried group-header promotion works; per-row labels suppressed in that case (built
      in slice 02, unchanged).
- [x] Flag derivation stays in the pure `closeFlags` module — computed server-side in
      `getCloseWorkspace` and returned; the UI only renders + formats.
- [x] `npx tsc --noEmit` clean; eslint clean.

## Blocked by

- Blocked by 03 (`03-workspace-editing.md`).

## User stories addressed

- User stories 13, 14, 15.
