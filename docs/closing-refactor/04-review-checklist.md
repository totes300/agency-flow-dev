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

- [ ] Callout renders all v1 flags with correct severity presentation (warnings amber-iconed;
      carried lines muted/informational; blocking items visually distinct).
- [ ] Clicking an item scrolls to and flash-highlights the target row.
- [ ] Flags resolve live as edits fix them (note added, duration reduced, rate configured); the
      "All clear — ready to close" state appears when no warnings remain (info lines may persist).
- [ ] Running-timer flag is warning-only (its blocking/non-blocking behaviour at commit is slice
      06's concern).
- [ ] Majority-carried group-header promotion works; per-row labels suppressed in that case.
- [ ] Flag derivation stays in the pure `closeFlags` module — the UI only renders.
- [ ] `npx tsc --noEmit` clean.

## Blocked by

- Blocked by 03 (`03-workspace-editing.md`).

## User stories addressed

- User stories 13, 14, 15.
