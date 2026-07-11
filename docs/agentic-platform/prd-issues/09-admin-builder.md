# 09 — Admin builder

**Type:** AFK
**Blocked by:** 04 (skills multi-select needs the skills system)
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Module 8*, *UX decisions › Builder placement*, *US 43–47*

## What to build

Agents become data anyone (admin) can author: a full-page, single-column form inside the workspace layout, reached via an admin-only "Manage agents" entry in the rail footer. Not a dashboard Settings tab, not a modal.

Scope:
- Manage-agents list (all org agents, incl. archived) + create/edit form: name, description/instructions (textarea), tool checklist (registry-fed, grouped by scope, each row showing human description + required scope), skills multi-select, run-permission segmented control (admins / everyone), model override, archive/restore.
- Agent CRUD mutations (admin-gated via requireAdmin); the tool checklist can only reference registry entries.
- Archived agents disappear from runners' rails; their historical threads remain readable.
- A registry tool that no longer exists (renamed/removed in code) is flagged in the form and dropped at runtime with a `system` block.
- The seeded Timesheet agent appears here and is editable like any other; the skills CRUD from slice 04 gets its final home in this area.
- Rail: the "+ New agent" affordance from the first-run empty state now routes here.

## Acceptance criteria

- [ ] An admin creates a new agent (e.g. "Client Overview" with the read tools) entirely from the UI — and it runs, with only the checked tools available to it.
- [ ] A member sees no Manage-agents entry and cannot call the CRUD mutations (server-enforced, not just hidden UI).
- [ ] Run-permission works: an admins-only agent is invisible to members in the rail; flipping to everyone makes it appear.
- [ ] Editing the Timesheet agent's instructions changes its behavior on the next run.
- [ ] Archiving removes the agent from rails but its old threads still open read-only-continuable per visibility rules.
- [ ] A stale tool reference is visibly flagged in the form and produces a system block (not a crash) at runtime.
- [ ] `npx tsc --noEmit` clean.

## User stories addressed

- US 43 (minimal builder), US 44 (seeded but editable Timesheet), US 45 (member has no builder access), US 46 (archive preserves history), US 47 (vetted-registry-only checklist)
