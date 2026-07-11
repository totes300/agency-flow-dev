# Agentic Platform — Wave 1 slices (tracer-bullet plan)

**Parent PRD:** `docs/agentic-platform/prd-v1.md` · **Approved:** 2026-07-11

Strategy: **tracer bullets** (Pragmatic Programmer). Slice 01 is the tracer — the thinnest possible path through *every* integration layer (schema → runner → tool registry → streaming → UI). It exists to validate the architecture and collect feedback before anything is built on top. Every subsequent slice is a vertical expansion of that proven spine: each one is independently committable, testable, and demoable end-to-end. Never build a layer horizontally.

**HITL** = has a human feedback gate (architecture validation / design review) before dependents proceed.
**AFK** = can be implemented and committed without human interaction.

## Slices

| # | File | Title | Type | Blocked by |
|---|------|-------|------|-----------|
| 00 | `00-shell-split-workspace-switch.md` | Shell split + workspace switch + empty rail | AFK | — |
| 01 | `01-tracer-minimal-agent-chat-loop.md` | **Tracer:** minimal agent chat loop | **HITL** | 00 |
| 02 | `02-stream-and-run-ux.md` | Stream & run UX | **HITL** | 01 |
| 03 | `03-timesheet-deterministic-tool.md` | Timesheet deterministic tool + table block | AFK | 01 |
| 04 | `04-skills-system.md` | Skills system | AFK | 01 |
| 05 | `05-timesheet-ai-columns.md` | Timesheet AI columns + timesheet-format skill | **HITL** | 03, 04 |
| 06 | `06-csv-artifact-canvas.md` | CSV artifact + canvas | AFK | 03 |
| 07 | `07-composer-mentions-upload.md` | Composer: Tiptap + mentions + upload | AFK | 01 |
| 08 | `08-proposal-engine.md` | Proposal engine | AFK | 02 |
| 09 | `09-admin-builder.md` | Admin builder | AFK | 04 |
| 10 | `10-connector-framework.md` | Connector framework | AFK | 01 |
| 11 | `11-permissions-audit-hardening.md` | Permissions, audit & hardening | AFK | 02, 05, 06, 07, 08, 09, 10 |

## Dependency graph

```
00 ─→ 01 ─┬→ 02 ─┬→ 08 ─┐
          │      └──────┤
          ├→ 03 ─┬→ 05 ─┤
          │      └→ 06 ─┤
          ├→ 04 ─┬→ 05  ├→ 11
          │      └→ 09 ─┤
          ├→ 07 ────────┤
          └→ 10 ────────┘
```

After 01 (and its feedback gate), slices 03 / 04 / 07 / 10 can proceed in parallel; 02 unlocks 08; 03+04 unlock 05; 11 closes Wave 1 against the PRD acceptance checklist.

## Conventions binding every slice

- `npx tsc --noEmit` clean before a slice is done; every mutation `.catch(toastError)`.
- All new tables orgId-scoped from the auth context; content-aware skeletons; dedicated empty-state components; page files as thin orchestrators.
- Verify `@convex-dev/agent`, shadcn, and Tiptap APIs via context7 before building on them.
- Update `docs/backlog.md` as slices land (repo convention).
