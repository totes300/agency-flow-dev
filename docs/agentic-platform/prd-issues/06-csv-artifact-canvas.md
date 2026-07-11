# 06 — CSV artifact + canvas

**Type:** AFK
**Blocked by:** 03 (works with deterministic-only columns; picks up AI columns automatically once 05 lands)
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *UX decisions › Canvas behavior*, *Schema changes › agentArtifacts*, *Module 5 (canvas parts)*

## What to build

The artifact pipeline end-to-end: the agent assembles a CSV from the timesheet table (existing CSV helpers: formula-injection guard, BOM), stores it as an `agentArtifacts` record, emits an `artifact` block in the chat, and the docked canvas renders it as a sheet.

Scope:
- `agentArtifacts` table + artifact assembly step in the timesheet flow (CSV built by code from the same row data as the table — never re-serialized through the model).
- `artifact` block renderer: name, kind, meta + Open action.
- Canvas panel: docked right flex-sibling ~520px with Expand-to-wide; auto-opens on the **first** artifact of a run, manual (Open) thereafter; does **not** collapse the rail; Esc/X closes; chat stays live; content-aware skeleton.
- Sheet renderer in the canvas: the timesheet as a proper grid with a totals row, matching table tokens; Export CSV action downloads the stored artifact (existing blob-download pattern).

## Acceptance criteria

- [ ] A timesheet run emits an artifact block; the canvas auto-opens with the sheet + totals row on the first artifact, and only manually afterwards.
- [ ] The rail stays expanded when the canvas opens; the chat narrows; Esc/X closes; a follow-up message works with the canvas open.
- [ ] Expand-to-wide toggles; closing and reopening from the artifact block works after leaving/returning to the thread.
- [ ] Export CSV downloads a file that matches the in-chat table cell-for-cell and opens cleanly in Excel/Google Sheets (BOM, quoting, injection guard verified with a `=SUM`-titled task).
- [ ] Artifact records are orgId-scoped and only readable by the thread owner (+ admin).
- [ ] `npx tsc --noEmit` clean.

## User stories addressed

- US 30 (table + CSV artifact in canvas), US 31 (export matches), US 34 (artifact block + Open), US 35 (sheet + actions in canvas), US 36 (close/reopen freely)
