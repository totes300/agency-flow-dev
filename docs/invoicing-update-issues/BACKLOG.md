# Invoicing Update — Issue Backlog

Tracking file for the Invoicing Update PRD. Every implementing agent updates this file as it picks up, ships, or unblocks an issue.

- **Parent PRD**: [`docs/invoicing-update-prd.md`](../invoicing-update-prd.md)
- **Visual reference**: [`docs/invoicing-update.md`](../invoicing-update.md), `prototypes/invoicing-final.html`
- **Shipping model**: All 13 issues land on a single feature branch and merge as one PR. Each issue is independently completable and verifiable; the bundle ships together.

---

## Status legend

- `[ ]` not started
- `[~]` in progress (note who/when)
- `[x]` complete (PR ref + merge commit)
- `[!]` blocked (note blocker)

## How to use this backlog

1. Pick the next `[ ]` issue whose dependencies are all `[x]`.
2. Update its line to `[~]` with your name + date.
3. Read the issue file, implement, verify locally.
4. Update to `[x]` with branch/commit ref. Update any unblocked downstream issues.

---

## Issues

### Foundation (no blockers)

- [x] [01 — Auth hardening](./01-auth-hardening.md) — backfill `requireAdmin` + hide nav for members. **AFK** · *Blocked by: none* · already in place on branch (no code change required)
- [x] [02 — `formatLastInvoiced` helper](./02-format-last-invoiced.md) — pure util + tests. **AFK** · *Blocked by: none*
- [x] [03 — Org-level invoice template settings](./03-org-invoice-templates.md) — `paymentInstructions` + `invoiceMessageTemplate` schema + Settings UI. **AFK** · *Blocked by: none*

### Backend extension

- [x] [04 — `createInvoice` extension](./04-create-invoice-extension.md) — `messageToClient` schema, auto-Paid €0 retainer, resume-existing draft + tests. **AFK** · *Blocked by: #03*

### Invoice document surfaces

- [x] [05 — `<InvoiceMessageBlock />`](./05-invoice-message-block.md) — editable message block on the invoice doc. **HITL** · *Blocked by: #04*
- [x] [06 — Payment instructions block](./06-payment-instructions-block.md) — render org-level instructions on invoice doc. **AFK** · *Blocked by: #03*

### Project Overview surfaces

- [x] [07 — `<InvoiceBanner />` shared component](./07-invoice-banner.md) — single banner across Fixed / T&M / Retainer Overviews. **HITL** · *Blocked by: #02, #04*
- [x] [08 — `<MonthlyBreakdownCard />` rebuild](./08-monthly-breakdown-card.md) — 6-col grid + sort + cycle header; deletes `<ReadyToInvoiceCard />`. **HITL** · *Blocked by: #02* · branch `invoiceing` (not yet committed) — `ReadyToInvoiceCard` retained for #11/#13 (still consumed by `app/(dashboard)/invoices/page.tsx`).

### Inbox

- [x] [09 — Inbox: To-generate section + unified query + batch generate](./09-inbox-to-generate.md) — `getReadyToInvoiceUnified`, `<InboxToGenerateSection />`, `generateAllWithinBudgetRetainerInvoices` + tests. **HITL** · *Blocked by: #04* · branch `invoiceing` (not yet committed). Batch is implemented as an **action** (Convex mutations are atomic; partial-failure semantics require per-row mutations via `runMutation`). 23 helper tests in `convex/lib/__tests__/readyToInvoice.test.ts`.
- [x] [10 — Inbox: Overdue section + bulk mark-paid + undo](./10-inbox-overdue.md) — `markInvoicesPaid` + `undoMarkInvoicesPaid` + tests, sticky bar UI. **HITL** · *Blocked by: none* · branch `invoiceing` (not yet committed). 10 helper tests in `convex/lib/__tests__/markPaid.test.ts`. Member-rejection covered upstream by `requireAdmin`.
- [x] [11 — Inbox page shell + metric cards + empty state](./11-inbox-page-shell.md) — compose sections, multi-currency cards, "All caught up". **AFK** · *Blocked by: #09, #10* · branch `invoiceing` (not yet committed). New: `getInboxEmptyStateContext` query, `<InboxMetricCards />`, `<InboxEmptyState />`, `useLastDefined` SWR hook. Page rewired to compose Overdue/To-generate/empty-state above tab nav + InvoiceList. URL state `?tab=all|draft|outstanding|paid`.

### Sidebar

- [x] [12 — Sidebar badge + `getInvoicingNavSignals`](./12-sidebar-badge.md) — badge + calendar-clock icon + tooltip. **AFK** · *Blocked by: #09* · branch `invoiceing` (not yet committed). Query returns `{toGenerateCount, overdueCount}` (deviation from spec's `hasOverdue: boolean` — needed by tooltip copy "{N} overdue"). `<InvoicesNavSignals />` rendered on the `/invoices` row alongside `<MyTasksBadge />`. Member account: row already gated by `adminOnly: true` from #01.

### Cleanup

- [x] [13 — Delete legacy `getReadyToInvoice`](./13-delete-legacy-query.md) — final cleanup once all callers migrated. **AFK** · *Blocked by: #07, #08, #09* · branch `invoiceing` (not yet committed). Removed: ~80 lines from `convex/invoices.ts` (legacy query) and `components/invoices/ready-to-invoice-card.tsx` (file deletion). `git grep getReadyToInvoice|ReadyToInvoiceCard|ReadyToInvoiceRow` over `*.ts`/`*.tsx`: 0 matches. Doc references in `docs/invoicing-*` history files retained intentionally.

---

## Dependency graph

```
01 (auth) ────────────────┐
02 (helper) ──────┬───────┤
03 (templates) ───┼───┐   │
                  │   ├── 04 (createInvoice) ──┬── 05 (msg block)
                  │   │                        ├── 07 (banner) ──┐
                  │   └── 06 (pay instructions)│                  │
                  └── 08 (breakdown) ──────────┤                  │
                                               ├── 09 (to-gen) ──┼── 11 (shell)
                                  10 (overdue) ┘                  │
                                               └── 12 (sidebar) ──┤
                                                                  └── 13 (cleanup)
```

## Out of scope (per PRD)

PDF generation · email sending · Stripe · mid-cycle PDFs · `void → cancel` rework · auto-generation cron · reminder emails · milestone Fixed billing · pro-rated retainer hours · configurable T&M cadence · all-or-nothing batch · confirmation dialog on bulk paid · dashboard billing card · `/projects` Status/To-bill columns.

---

## TODOs deferred to later phases

Captured during the 2026-05-02 multi-POV review pass. Each item is real but
explicitly out of scope for this PR; they live here so they aren't lost.

### Audit carry-overs (pre-existing, not introduced by this PR)
- **Audit #3** — Retainer revert ignores later drafts on the same project. The
  unwind guard in `findLaterRetainerInvoice` returns the latest later invoice,
  but a draft chain ahead of the reverted one isn't recomputed in step. **When**: paying customer with multiple concurrent retainer drafts.
- **Audit #6** — `getInvoice` cross-tenant guard on `ctx.db.get(catId)`: a forged
  `workCategoryId` from another org could surface in the invoice editor's
  category dropdown source. Defense-in-depth missing. **When**: hardening pass before first paid customer.

### Scale (MVP-acceptable; will bite at customer scale)
- **N+1 in `enumerateReadyRows`** — `convex/invoices.ts:387` walks every project × task × entry per Inbox open. Need an aggregate denormalization (active billable totals indexed by orgId) before crossing ~50 projects per org.
- **Non-batched line-item insert** in `createInvoice` — sequential `await ctx.db.insert("invoiceLineItems", …)` will hit Convex's per-mutation read/write quota (~8MB) at ~1000+ entries on a single project. Switch to `Promise.all` batching.
- **No idempotency on `generateAllWithinBudgetRetainerInvoices`** — double-click protection is client-only (button disable). At scale, add a per-call lease keyed on `orgId + nextInvoiceNumber`.

### Money correctness (MVP-acceptable; revisit before paying customers)
- **Floating-point money** — JS `number` for currency throughout. `getInvoiceMetrics:270` accumulates floats with per-step `round2` which can drift sub-cent over many invoices. Migrate to integer cents storage before taking real customers.

### UX surface gaps (small, follow-up PRs)
- **T&M draft accumulation surface** — `findResumableInvoice` returns `none` when an existing draft has a different period, so a project can accumulate N T&M drafts on disjoint custom ranges. `getProjectInvoiceMetrics` doesn't surface "you have 4 drafts on this project". Add a soft warning to the project Invoices tab.
- **`mini-calendar.tsx` accessibility** — no roving tabindex, no arrow-key navigation, no `role="grid"`. The component is keyboard-tabbable button-by-button but doesn't meet WAI-ARIA Date Picker pattern. Either patch (~50 lines) or migrate callers to shadcn `Calendar` (react-day-picker — already a11y-correct).
- **Mutation-level integration tests** — PRD § Testing Decisions called for testing the four invoice mutations end-to-end. The current 66 tests cover the pure helper layer (`invoiceCreation`, `markPaid`, `readyToInvoice`); helper purity + `requireAdmin` cover most of the risk, but a `convex-test` pass on the four mutations would close the gap.
- **`invoice-message-block.tsx` autofocus refinement** — current `autoFocus={isEditing && !persistedMessage}` only fires when entering edit mode from the empty-state "+ Add" affordance. Editing an existing message doesn't autofocus on click into the textarea — that's the native onClick → focus path, which works. Document or migrate to a more deliberate `useEffect`-based focus trigger if user-tested behavior diverges.
