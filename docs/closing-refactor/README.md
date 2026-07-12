# Closing Refactor — Month-Close Workflow

Tracer-bullet breakdown of [`docs/prd-month-close.md`](../prd-month-close.md) (the source of truth
for all semantics — especially invariants I1–I4, which MUST NOT be deviated from without updating
the PRD first).

Visual reference: approved clickable prototype —
https://claude.ai/code/artifact/86fea3b7-689c-4a94-8a1a-a8b70d82788a (label `skip-to-next-close`).

## Slices & dependency graph

```
01-billing-scope-core          (no blockers — START HERE)
        │
02-close-workspace-readonly
        │
03-workspace-editing
      ┌─┴─────────────┐
04-review-checklist  05-skip-to-next-close
      └─┬─────────────┘
06-commit-integration
      ┌─┴─────────────┐
07-client-documents  08-close-queue-and-billing-nav   (parallelizable)
```

| # | File | Type | Blocked by |
|---|------|------|------------|
| 01 | [01-billing-scope-core.md](01-billing-scope-core.md) | AFK | — |
| 02 | [02-close-workspace-readonly.md](02-close-workspace-readonly.md) | AFK | 01 |
| 03 | [03-workspace-editing.md](03-workspace-editing.md) | AFK | 02 |
| 04 | [04-review-checklist.md](04-review-checklist.md) | AFK | 03 |
| 05 | [05-skip-to-next-close.md](05-skip-to-next-close.md) | AFK | 03 |
| 06 | [06-commit-integration.md](06-commit-integration.md) | AFK | 04, 05 |
| 07 | [07-client-documents.md](07-client-documents.md) | AFK | 06 |
| 08 | [08-close-queue-and-billing-nav.md](08-close-queue-and-billing-nav.md) | AFK | 06 |

Slice 01 carries the entire financial risk (pure, exhaustively tested); every later slice only
consumes it. Slice 06 is the only one that touches existing money mutations — by then the scope
logic is proven.

## Definition of done (every slice)

- All acceptance criteria checked.
- `npx tsc --noEmit` → 0 errors. Existing test suites pass unchanged.
- New/changed pure logic has co-located unit tests (Vitest, existing `convex/lib/*.test.ts` prior
  art).
- `docs/backlog.md` updated: task checkboxes, verification section, deferred TODOs (mandatory
  project convention).
- Conventions honored: thin page orchestrators, shared components, content-aware skeletons,
  loading→empty→content, every mutation has error handling, URL-persisted filters, no pill badges
  (dot + muted text), raw ledger (no rounding) on review surfaces.

## Kickoff prompt for the developer agent

> You are implementing the Month-Close Workflow for Agency Flow (Next.js 16 + Convex + Clerk).
>
> Read, in this order, before writing any code:
> 1. `CLAUDE.md` (project conventions — note especially: NEVER `git stash`, 0 TS errors, backlog
>    tracking, Convex guidelines at `convex/_generated/ai/guidelines.md`)
> 2. `docs/prd-month-close.md` — the PRD. The "Core invariants" section (I1–I4) is binding: if an
>    implementation detail seems to conflict with an invariant, STOP and flag it — never
>    reinterpret the invariant.
> 3. `docs/closing-refactor/README.md` and the slice files 01–08.
>
> Work slice by slice in dependency order, starting with
> `docs/closing-refactor/01-billing-scope-core.md`. One slice = one PR-sized change on the current
> branch. Complete every acceptance criterion and the Definition of done in the README before
> declaring a slice finished; tick the checkboxes in the slice file as you complete them.
>
> This is billing-critical code. Non-negotiables:
> - All close-membership/money questions go through the pure `billingScope` module — no surface
>   may re-derive membership from dates.
> - The no-skip baseline regression (slice 01) must prove today's behaviour is preserved
>   bit-for-bit before any consumer is switched over.
> - Server-side re-derivation at commit; never trust client-provided entry sets or amounts.
> - Existing mutations' external contracts (`createInvoice`, `closePeriod`,
>   `closeRetainerCycle`, unsettle paths, invoice numbering) stay unchanged except for entry
>   selection routing through `billingScope`.
>
> The approved visual reference is the prototype at
> https://claude.ai/code/artifact/86fea3b7-689c-4a94-8a1a-a8b70d82788a — match its Notion-restraint
> style and the PRD's "UX Decisions" section exactly (flat lists, one primary button per screen,
> dot + muted text instead of pills, hover-revealed row actions, gray callout checklist).
>
> After each slice: run `npx tsc --noEmit` and the test suite, update `docs/backlog.md`, then
> summarize what changed, what you verified, and what the next slice needs.
