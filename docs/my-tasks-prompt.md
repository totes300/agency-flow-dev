# My Tasks Implementation Prompt

> Copy-paste this into a new Claude Code session. Start in **Plan mode** first.

---

## Prompt

Implement the "My Tasks" feature for this Agency Flow app. This is a personal, distraction-free task view at `/my-tasks`.

### Required reading BEFORE you start

Read these files in this order — they are your source of truth:

1. `CLAUDE.md` — project conventions, tech stack, architecture rules
2. `convex/_generated/ai/guidelines.md` — Convex API patterns (MUST read before writing any Convex code)
3. `docs/today-tab-prd.md` — the full PRD with every decision, UI spec, and acceptance criteria
4. `docs/today-view-plan.md` — the 8-phase implementation plan with test specs

### Implementation rules

- **Test-first development**: Write vitest tests BEFORE implementing each phase. Run `npm run test` to verify tests fail first (red), then implement to make them pass (green).
- **After EVERY phase**: run `npm run test` (all green) + `npx tsc --noEmit` (zero errors) + visually verify in browser. Only then commit and move to the next phase.
- **Follow the phase order**: Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Do not skip or merge phases.
- **Commit after each phase** with a descriptive message. Do not batch multiple phases into one commit.
- **Update the backlog checklist** at the bottom of `docs/today-view-plan.md` after each phase — check off completed items.
- **Reuse existing components** wherever possible (drawer, `InlineTimeCell`, `SortableTaskRow` pattern, `TaskPreviewPopover`, status/category badges). Do NOT hand-roll UI that already exists in `components/`.
- **Single source of truth**: tasks are the same entities everywhere. Changes on `/my-tasks` are immediately visible on `/tasks` and vice versa (Convex real-time).
- **Follow CLAUDE.md conventions strictly**: page files are thin orchestrators (<200 lines), domain UI elements are shared components, helpers go in `lib/`, zero TypeScript errors at all times.


Start by entering Plan mode. Read all 4 required files, then present your implementation plan for Phase 1. Wait for my approval before writing any code.
