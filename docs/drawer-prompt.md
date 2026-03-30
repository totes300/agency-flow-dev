# Task Detail Drawer — Implementation Prompt

## Context

Read `docs/drawer-plan.md` — it contains the full architectural plan for adding a Bonsai-style task detail drawer alongside the existing modal. The plan has 8 committable phases, each with verification checklists.

## Your task

Implement the drawer plan **phase by phase**, in order (Phase 1 → 8). For each phase:

1. **Read the plan** — re-read `docs/drawer-plan.md` to understand the current phase's scope, files, and verification checklist.
2. **Read all files you'll touch** — understand the existing code before changing it. Never modify code you haven't read.
3. **Implement** — write clean, senior-level code. Follow all conventions in `CLAUDE.md`. Zero TypeScript errors (`npx tsc --noEmit`).
4. **Self-verify** — go through the phase's verification checklist item by item. For code-verifiable items (TypeScript, build), run the commands. For UI-verifiable items, note them as "manual verification needed."
5. **Update the plan** — after completing a phase, update `docs/drawer-plan.md`:
   - Check off the verification items you confirmed (change `[ ]` to `[x]`)
   - Add a `**Status: DONE**` line under the phase heading
   - Note any deviations or decisions made during implementation
6. **Commit** — use the commit message specified in the plan. Do NOT commit files that shouldn't be committed (.env, etc).
7. **Move to the next phase** — only after the current phase is fully verified and committed.

## Rules

- **One phase at a time.** Never start Phase N+1 before Phase N is committed and verified.
- **The app must work after every commit.** If you break something, fix it before committing.
- **Refactor phases (1–4) must not change any visible behavior.** The modal must work identically before and after. If any verification item fails, stop and fix.
- **Reuse existing components.** Don't create new components when existing ones can be adapted (see the reuse plan in the doc).
- **Follow the plan's architecture.** If you think something should change, explain why and update the plan BEFORE implementing.
- **Phase 6 is the hardest.** The sticky comment input + shared scroll container with ActivityFeed + auto-scroll is the trickiest part. Take extra care with scroll ref management. Test thoroughly.

## How to start

Begin with Phase 1. Read `docs/drawer-plan.md` section "Phase 1: Schema + mutation", then implement it.
