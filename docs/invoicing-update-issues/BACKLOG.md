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

- [ ] [01 — Auth hardening](./01-auth-hardening.md) — backfill `requireAdmin` + hide nav for members. **AFK** · *Blocked by: none*
- [ ] [02 — `formatLastInvoiced` helper](./02-format-last-invoiced.md) — pure util + tests. **AFK** · *Blocked by: none*
- [ ] [03 — Org-level invoice template settings](./03-org-invoice-templates.md) — `paymentInstructions` + `invoiceMessageTemplate` schema + Settings UI. **AFK** · *Blocked by: none*

### Backend extension

- [ ] [04 — `createInvoice` extension](./04-create-invoice-extension.md) — `messageToClient` schema, auto-Paid €0 retainer, resume-existing draft + tests. **AFK** · *Blocked by: #03*

### Invoice document surfaces

- [ ] [05 — `<InvoiceMessageBlock />`](./05-invoice-message-block.md) — editable message block on the invoice doc. **HITL** · *Blocked by: #04*
- [ ] [06 — Payment instructions block](./06-payment-instructions-block.md) — render org-level instructions on invoice doc. **AFK** · *Blocked by: #03*

### Project Overview surfaces

- [ ] [07 — `<InvoiceBanner />` shared component](./07-invoice-banner.md) — single banner across Fixed / T&M / Retainer Overviews. **HITL** · *Blocked by: #02, #04*
- [ ] [08 — `<MonthlyBreakdownCard />` rebuild](./08-monthly-breakdown-card.md) — 6-col grid + sort + cycle header; deletes `<ReadyToInvoiceCard />`. **HITL** · *Blocked by: #02*

### Inbox

- [ ] [09 — Inbox: To-generate section + unified query + batch generate](./09-inbox-to-generate.md) — `getReadyToInvoiceUnified`, `<InboxToGenerateSection />`, `generateAllWithinBudgetRetainerInvoices` + tests. **HITL** · *Blocked by: #04*
- [ ] [10 — Inbox: Overdue section + bulk mark-paid + undo](./10-inbox-overdue.md) — `markInvoicesPaid` + `undoMarkInvoicesPaid` + tests, sticky bar UI. **HITL** · *Blocked by: none*
- [ ] [11 — Inbox page shell + metric cards + empty state](./11-inbox-page-shell.md) — compose sections, multi-currency cards, "All caught up". **AFK** · *Blocked by: #09, #10*

### Sidebar

- [ ] [12 — Sidebar badge + `getInvoicingNavSignals`](./12-sidebar-badge.md) — badge + calendar-clock icon + tooltip. **AFK** · *Blocked by: #09*

### Cleanup

- [ ] [13 — Delete legacy `getReadyToInvoice`](./13-delete-legacy-query.md) — final cleanup once all callers migrated. **AFK** · *Blocked by: #07, #08, #09*

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
