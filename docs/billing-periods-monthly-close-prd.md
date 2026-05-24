# PRD: Billing Periods, Client Documents, and Monthly Close

> Status: Draft for implementation planning
> Supersedes the "reports are live truth / no period locking" parts of `docs/invoicing-refactor.md`
> Product model: Harvest-style monthly close + Stripe-style payment semantics + one shared client document engine

## Problem Statement

The owner needs one monthly operating surface where project work can be reviewed, accounted for, locked, documented, and invoiced when money is due.

Today invoices exist and retainer monthly reports can be rendered, but there is no durable concept of "this work was reviewed and closed for this billing period." That creates practical problems:

- Retainer reports are live renders. Backdated edits, task renames, category changes, or project setting changes can silently alter a report after it was sent.
- Time entries are locked only by `invoiceId`, which works for T&M invoices but not for zero-amount statements, fixed-fee delivery evidence, or retainer months without overage.
- Statement and invoice documents need the same editing surface: the owner often rounds line items, rewrites descriptions, hides tiny rows, and adjusts client-facing presentation without changing the source time ledger.
- Rollover retainers need monthly client documents even when financial settlement happens only at cycle end.
- Fixed-fee projects still create time entries that must not float forever as unaccounted work once the fixed fee has been billed or the delivery period has been closed.
- The owner needs to find a project/month later and download the exact client document that was sent.
- `/invoices` should remain the financial ledger and payment chase surface, not the whole monthly close ritual.

## Solution

Create a durable **billing period ledger** and one shared **client document system**.

The system has three separate concepts:

- **Billing Period**: the operational close record. It owns the project, date range, selected work, close/accounting state, totals, lock state, retainer cycle metadata, and audit events.
- **Billing Document**: the client-facing PDF/editable document generated from a billing period. It can be a `statement` or an `invoice`, but it uses the same editor, same line item model, and same visual layout.
- **Payment State**: invoice-only financial state. A document with money due appears in `/invoices`, can become paid, and participates in unpaid/overdue/payment workflows. A statement does not.

The key product rule:

> A statement and an invoice are the same client document shape. The difference is financial semantics, not UI architecture.

This avoids building one report system and one invoice system that eventually drift apart. It also avoids treating zero-amount statements as invoices in the financial ledger.

Monthly Close becomes the owner's billing queue:

- **T&M**: choose project, interval or eligible entries, then create one invoice document linked to one billing period.
- **Fixed fee**: close delivery/time evidence into billing periods. Fixed-fee revenue comes from fixed-fee invoice documents, while time entries become accounted for through the period.
- **Retainer without rollover**: close each month. If there is no overage, create a statement document. If there is overage, create an invoice document.
- **Retainer with rollover**: close each month with statement documents. At cycle end, create one cycle settlement document; it is a statement when there is no overage and an invoice when money is due.

The invoice list remains the financial ledger. Monthly Close is the operational queue.

## Core Concepts

### Billing Period

`billingPeriods` is the operational ledger.

A billing period means: "this set of work was reviewed and accounted for as one billing/reporting unit."

It owns:

- project and client
- period/date range
- billing model snapshot
- close/accounting state
- financial/reporting totals
- retainer cycle metadata
- optional linked billing document
- audit events

It does not replace the client document. It is the ledger record behind the document and the canonical source for whether time entries are accounted for.

### Billing Document

`billingDocuments` is the shared client-facing document table.

A billing document is generated from a billing period, stored as an editable snapshot, and later rendered/downloaded exactly as sent.

It owns:

- project, client, and billing period links
- document number or display identifier
- `kind`: `statement` or `invoice`
- issue date
- lifecycle status
- payment fields when `kind = "invoice"`
- editable title/subject/message fields
- totals and display metadata
- linked document line items

Documents are used when:

- T&M selected work is billed
- fixed fee balance or milestone is billed
- fixed fee delivery evidence is closed without a new bill
- a retainer month has no overage
- a retainer month has overage
- a rollover retainer month is inside the cycle
- a rollover cycle settlement has or does not have overage

The same document renderer should handle statements and invoices. Invoice-only fields are hidden or inactive for statements.

### Billing Document Line Items

`billingDocumentLineItems` stores the editable rows shown to the client.

Line items are generated from time entries/tasks/categories and period snapshots at close time, then may be edited by the owner.

Editing a document line item changes only the client-facing document. It does not mutate the source time entries.

Line items should support:

- description edits
- quantity/minutes edits for display
- hiding/removing tiny client-facing rows
- grouping or rounding decisions
- manual summary lines
- amount-bearing rows for invoices
- zero-amount rows for statements
- optional source time entry references for traceability

### Statement

A statement is a billing document with `kind = "statement"`.

It communicates what work was done and how the period settled, but it is not a receivable, not unpaid, not overdue, and not a payment request.

Statements:

- can be drafted, edited, issued, voided, and downloaded
- lock their source time entries while live
- do not appear in `/invoices`
- appear on the project page and Monthly Close history
- may have totals, usage, budget, balance, and zero amount due

### Invoice

An invoice is a billing document with `kind = "invoice"`.

It requests payment and participates in financial/payment workflows.

Invoices:

- can be drafted, edited, issued, paid, voided, and downloaded
- lock their source time entries while live
- appear in `/invoices`
- appear on the project page and Monthly Close history
- own amount due, due date, payment state, and payment chase behavior

### Time Entry Ownership

Time entries point to the smallest natural period that owns their billing close:

- T&M: selected entries point to the T&M billing period created for that invoice batch.
- Fixed: included delivery/cost evidence entries point to the fixed billing period, but revenue comes from fixed-fee document line items.
- Non-rollover retainer: entries in the closed month point to that month period.
- Rollover retainer monthly close: entries in each closed month point to that month period.
- Rollover cycle settlement: the cycle settlement period does not own earlier entries directly; it summarizes already-closed monthly periods in the same cycle.

This preserves month-level audit and keeps reopen/correction behavior local.

## State Model

Keep period state small:

```ts
billingPeriods.status = "draft" | "closed" | "void"
billingPeriods.documentId = Id<"billingDocuments"> | undefined
```

Meaning:

- `draft`: work has been claimed into a period/document draft. Linked entries are locked so the document and ledger cannot drift during editing.
- `closed`: the owner considers the period finalized/accounted for. The linked document has been issued/downloaded or otherwise accepted as the record.
- `void`: the period close was cancelled. History remains in events.

There is no `invoiced` period status. Whether a client owes money is document/payment state.

There is no `reopened` period status. Reopen is an event and a transition back to `draft` or a new replacement period, with a required admin reason.

Document state:

```ts
billingDocuments.kind = "statement" | "invoice"
billingDocuments.status = "draft" | "issued" | "paid" | "void"
```

Rules:

- `paid` is valid only for `kind = "invoice"`.
- `issued` means the owner has exported/sent/accepted the document as the client-facing record.
- A statement is complete at `issued`; it has no payment lifecycle after that.
- An invoice enters payment chase once issued and remains unpaid until marked paid or void.

Every meaningful transition is recorded in `billingPeriodEvents`.

## Lock Predicate

A time entry is locked if:

- it has a `billingPeriodId` pointing to a non-void billing period, or
- it has a legacy `invoiceId` pointing to a non-void invoice during migration.

Draft periods lock entries. This is intentional.

The best-practice UX is: once work is claimed into a draft client document, the raw ledger should not continue changing underneath it. If the owner needs presentation changes, they edit document line items. If the owner needs ledger corrections, they reopen/void/regenerate through an auditable flow.

Do not use a project-level date lock as the canonical source of truth in v1. Date locks are too blunt for T&M partial billing and selected-entry close flows.

## User Stories

### Monthly Close

1. As an agency owner, I want to choose a month in one Monthly Close view, so I can close the previous month without hunting through projects.
2. As an agency owner, I want the view grouped by client and project, so I can scan my monthly work quickly.
3. As an agency owner, I want each row to show project, period, hours, amount due, document kind, accounting state, and required action.
4. As an agency owner, I want zero-amount statement work to appear in Monthly Close, so it does not silently float outside the close process.
5. As an agency owner, I want closed rows to leave the active queue, so I do not process the same period twice.
6. As an agency owner, I want completed rows available in Monthly Close history, so I can verify what was closed.
7. As an agency owner, I want to reopen or void a period only with a reason, so corrections remain auditable.

### T&M

8. As an agency owner, I want to select a T&M project, date interval, and eligible time entries, so I can invoice the exact work I choose.
9. As an agency owner, I want selected entries to become part of one billing period when I create the invoice document, so they stop appearing as unaccounted work.
10. As an agency owner, I want unselected entries in the same date range to remain open, so partial billing stays possible.
11. As an agency owner, I want the generated invoice to be editable before issuing, so I can adjust client-facing line item presentation.
12. As an agency owner, I want T&M revenue reports to read invoice documents/periods, not raw open time, so revenue is based on closed financial records.

### Fixed Fee

13. As an agency owner, I want fixed-fee projects with remaining contract balance to appear in Monthly Close when a billing action is needed.
14. As an agency owner, I want fixed-fee time entries to become accounted for through billing periods, so delivery evidence does not float forever.
15. As an agency owner, I want fixed project revenue to come from fixed-fee document line items, not time entry rates.
16. As an agency owner, I want fixed price, amount already billed, amount due, and remaining balance snapshotted on the period.
17. As an agency owner, I want included delivery entries to lock once a fixed billing/close unit is drafted.
18. As an agency owner, I want fixed-fee entries to display as "closed" or "accounted for", not necessarily "invoiced", so the UI does not imply hourly billing.

### Retainer - No Rollover

19. As an agency owner, I want to close each retainer month once.
20. As an agency owner, I want all billable and non-billable entries in the closed month to point to that month period.
21. As an agency owner, if the month has no overage, I want close to generate an editable statement document.
22. As an agency owner, if the month has overage, I want close to generate an editable invoice document.
23. As an agency owner, I want statement and invoice documents to share the same layout and editor.
24. As an agency owner, I want monthly fee, included time, overage rate, and usage totals snapshotted on the period/document.
25. As an agency owner, I want to edit document line items before issuing without changing source time entries.
26. As an agency owner, I want to download the same issued document later from the project/month.

### Retainer - Rollover

27. As an agency owner, I want each month inside a rollover cycle to close as its own monthly period.
28. As an agency owner, I want mid-cycle months to produce editable statement documents only.
29. As an agency owner, I want the cycle end to create a separate cycle settlement period.
30. As an agency owner, I want the cycle settlement period to summarize the monthly periods in that cycle.
31. As an agency owner, if the closed cycle has overage, I want one invoice document linked to the cycle settlement period.
32. As an agency owner, if the closed cycle has no overage, I want one statement document linked to the cycle settlement period.
33. As an agency owner, I want reopening an earlier month to mark the cycle settlement as needing review through derived UI state and events.

### Documents

34. As an agency owner, I want one document editor for statements and invoices, so the workflow stays consistent.
35. As an agency owner, I want invoice-only fields hidden or inactive on statements, so statements cannot be mistaken for payment requests.
36. As an agency owner, I want issued documents to render from stored line items, not live task/time/category data.
37. As an agency owner, I want voided documents to remain visible in history, so audit context is preserved.
38. As an agency owner, I want statements excluded from unpaid, overdue, paid, and revenue collection views.
39. As an agency owner, I want invoices included in unpaid, overdue, paid, and revenue collection views.

### Locking and Correction

40. As an agency owner, I want entries linked to a draft or closed billing period to be read-only.
41. As an agency owner, I want document edits to change the document only, not the underlying time ledger.
42. As an agency owner, I want admin-only reopen with a required reason.
43. As an agency owner, I want reopening blocked if an issued or paid invoice depends on the period unless it is voided first.
44. As an agency owner, I want voided statements and voided periods to remain visible in history but not block re-close when appropriate.

## Implementation Decisions

### One Document Engine

Do not build separate long-term `reports` and `invoices` document systems.

Build or evolve toward one shared document system:

- `billingDocuments.kind = "statement" | "invoice"`
- shared line item editor
- shared PDF/document renderer
- shared issue/void lifecycle
- invoice-only payment fields and payment state

The existing invoice editor and invoice line item model are the best starting point. The implementation may evolve the existing `invoices` and `invoiceLineItems` tables in place first, then rename later if that reduces migration risk. The target domain model is still `billingDocuments`.

### `/invoices` Is a Projection

The global `/invoices` page should show only financial documents:

- `kind = "invoice"`
- amount due greater than zero
- non-void unless explicitly viewing history

Statements should not appear in `/invoices`. They belong in Monthly Close history and project documents/monthly breakdown.

### Project Pages

Project pages should expose client documents by month/period:

- T&M invoice documents
- fixed-fee invoice documents
- fixed-fee accounted/closed periods
- retainer statement documents
- retainer invoice documents
- rollover cycle settlement documents

The existing retainer monthly breakdown is a good presentation foundation, but its links should eventually point to stored billing documents instead of live report renders.

### Fixed Fee Semantics

Fixed-fee time entries should not be described as revenue-driving "invoiced hours."

For fixed projects:

- revenue comes from fixed-fee document line items
- time entries are delivery/cost evidence
- closing a period marks time entries as accounted for through `billingPeriodId`
- UI should show "Closed" or "Accounted" for those entries

This avoids the false implication that each fixed-fee time entry was individually billed.

### Draft Locks

Creating a draft billing document claims the source work and locks linked time entries.

This prevents the source ledger from changing while the owner edits the client-facing document. If the raw ledger is wrong, the owner uses reopen/void/regenerate rather than editing source entries behind the document.

## Schema Changes

### Add `billingPeriods`

Logical fields:

- `orgId`
- `projectId`
- `clientId`
- `kind`: `tm`, `fixed`, `retainer`
- `periodScope`: `batch`, `fixed_balance`, `fixed_delivery`, `month`, `cycle_settlement`
- `billingTypeSnapshot`: `t_and_m`, `fixed`, `retainer`
- `periodStart`
- `periodEnd`
- `status`: `draft`, `closed`, `void`
- `documentId`
- `previousPeriodId`
- `cycleKey`
- `cycleStart`
- `cycleEnd`
- `cyclePosition`
- `cycleLengthSnapshot`
- `currency`
- `billableMinutes`
- `nonBillableMinutes`
- `includedMinutes`
- `usedMinutes`
- `balanceMinutes`
- `overageMinutes`
- `amountDue`
- `fixedPrice`
- `fixedBilledAmount`
- `fixedRemainingAmount`
- `baseRetainerAmount`
- `overageRate`
- `roundingMinutes`
- `closedAt`
- `closedBy`
- `voidedAt`
- `createdAt`
- `updatedAt`
- `createdBy`

### Add or Evolve to `billingDocuments`

Logical fields:

- `orgId`
- `billingPeriodId`
- `projectId`
- `clientId`
- `kind`: `statement`, `invoice`
- `status`: `draft`, `issued`, `paid`, `void`
- `number`
- `prefix`
- `title`
- `subject`
- `issueDate`
- `dueDate`
- `paidAt`
- `periodStart`
- `periodEnd`
- `currency`
- `subtotal`
- `total`
- `amountDue`
- `messageToClient`
- `monthlyFeeSnapshot`
- `includedMinutesSnapshot`
- `usedMinutesSnapshot`
- `balanceMinutesSnapshot`
- `overageMinutesSnapshot`
- `overageRateSnapshot`
- `fixedPriceSnapshot`
- `fixedBilledAmountSnapshot`
- `fixedRemainingAmountSnapshot`
- `issuedAt`
- `voidedAt`
- `createdAt`
- `updatedAt`
- `createdBy`

Rules:

- `paidAt` and payment collection fields apply only when `kind = "invoice"`.
- `amountDue` must be `0` for statements.
- `status = "paid"` is valid only for invoices.

### Add or Evolve to `billingDocumentLineItems`

Logical fields:

- `orgId`
- `documentId`
- `sortOrder`
- `lineType`: `time`, `fixed`, `overage`, `summary`, `manual`, `adjustment`
- `description`
- `quantityMinutes`
- `quantity`
- `unitLabel`
- `unitPrice`
- `amount`
- `amountOverridden`
- `workCategoryId`
- `sourceTimeEntryIds`
- `hiddenFromClient`
- `createdAt`
- `updatedAt`

`sourceTimeEntryIds` is for traceability only. The document line is the client-facing truth after edits.

### Add `billingPeriodEvents`

Logical fields:

- `orgId`
- `billingPeriodId`
- `projectId`
- `documentId`
- `type`: `created`, `document_created`, `document_issued`, `document_voided`, `period_closed`, `period_reopened`, `period_voided`, `invoice_paid`, `invoice_unpaid`, `snapshot_updated`
- `actorUserId`
- `reason`
- `metadata`
- `createdAt`

`reopened` remains valid as an event type only. It is not a period status.

### Extend `timeEntries`

- `billingPeriodId`

Keep `invoiceId` temporarily for migration and compatibility with existing invoice flows. Long term, lock/accounting state should come from `billingPeriodId`.

### Replace or Migrate `retainerPeriods`

The existing `retainerPeriods` table should not remain as a competing long-term period concept.

It should either be migrated into `billingPeriods` or replaced by `billingPeriods` for new close flows.

### Indexes

Support:

- periods by org and status
- periods by project and date range
- periods by project and cycle key
- periods by previous period
- periods by document
- documents by org, kind, and status
- documents by billing period
- documents by project and period
- document line items by document
- events by billing period and creation time
- time entries by billing period

## API Contracts

### Monthly Close Query

Input: selected month or date range.

Output:

- T&M rows ready to review and invoice
- fixed-fee rows with remaining balance ready to invoice
- fixed-fee delivery/time rows ready to account for
- retainer month rows ready to close
- rollover month rows ready to close/statement
- rollover cycle settlement rows ready to settle
- completed periods for the selected month

Rows include client, project, period, hours, amount due, document kind, status, action, and drill-in IDs.

Implementation should evolve the existing Ready/Uninvoiced feed rather than create a separate competing model. The feed must include zero-amount close actions, not only invoiceable rows.

### Close T&M Period Mutation

Input:

- project
- selected time entry IDs or task-derived selection
- invoice options

Behavior:

- validate selected entries are eligible
- create billing period with `status = "draft"`
- link entries to period
- create billing document with `kind = "invoice"`
- create editable document line items
- write events

### Close Fixed Period Mutation

Input:

- project
- optional date range or selected delivery time entries
- invoice/accounting options

Behavior:

- validate project state
- create billing period with `status = "draft"`
- snapshot fixed price, already billed, amount due, and remaining balance
- link included delivery entries to period
- create invoice document when money is due
- create statement/accounting document when the action is delivery evidence only
- write events

### Close Retainer Month Mutation

Input:

- project
- year
- month

Behavior:

- validate month is closeable
- compute period snapshot
- create billing period with `periodScope = "month"` and `status = "draft"`
- link billable and non-billable entries to the period
- if non-rollover overage exists, create invoice document
- otherwise create statement document
- write events

### Close Rollover Month Mutation

Input:

- project
- year
- month

Behavior:

- validate month is inside a rollover cycle and closeable
- compute month snapshot
- create monthly retainer period
- link that month's billable and non-billable entries
- create editable monthly statement document
- write events

### Close Rollover Cycle Mutation

Input:

- project
- cycle closing month

Behavior:

- ensure all months in the cycle are closed, or fail with a clear missing-month state
- create a separate retainer period with `periodScope = "cycle_settlement"`
- do not link time entries directly to the cycle settlement period
- compute cycle snapshot from monthly periods in the same `cycleKey`
- create invoice document if cycle overage exists
- otherwise create statement document
- write events

### Edit Billing Document Mutation

Input:

- document ID
- document field edits and/or line item edits

Behavior:

- allow edits only while document is `draft`
- update document fields or document line items
- never mutate source time entries
- write audit events for meaningful changes if needed

### Issue Billing Document Mutation

Input:

- document ID

Behavior:

- validate document is draft
- transition document to `issued`
- stamp `issuedAt`
- transition billing period to `closed`
- write event

### Mark Invoice Paid Mutation

Input:

- invoice-kind document ID

Behavior:

- validate document is `kind = "invoice"`
- validate document is issued
- transition document to `paid`
- stamp `paidAt`
- write event

### Reopen Period Mutation

Input:

- billing period ID
- reason

Behavior:

- admin only
- require reason
- block if an issued or paid invoice depends on the period
- void or mark dependent draft document as no longer authoritative according to product decision
- transition period back to `draft` or create a replacement draft period
- write event
- entry lock state changes through the derived lock predicate

## Document Editing Rules

Document editing is presentation editing, not time ledger editing.

Allowed:

- rename line item descriptions
- round displayed minutes/hours
- hide tiny client-facing rows
- add manual summary lines
- reorder lines
- edit message/title/subject
- override displayed amount on editable invoice rows when allowed

Not allowed through document editing:

- changing source time entry duration
- changing source time entry billability
- moving source entries between tasks/projects
- changing the billing period's canonical worked minutes without a reopen/re-close flow

If the owner needs to correct the actual time ledger, they must reopen/void/regenerate when allowed.

## Reporting Rules

Revenue reporting should not read raw time entries as revenue.

Use:

- T&M revenue from issued/paid invoice documents linked to T&M periods
- fixed revenue from fixed invoice document line items linked to fixed periods
- retainer base revenue from closed retainer month snapshots if the app tracks retainer revenue
- retainer overage revenue from invoice documents linked to month or cycle periods
- utilization/cost from time entries linked to periods

Client-facing document display should read from `billingDocuments` and `billingDocumentLineItems`, not live task/time/category data.

Statements should not affect unpaid, overdue, paid, or payment chase metrics.

## Module Design

### Billing Period Ledger

Owns creation, transitions, snapshots, sequential month links, cycle metadata, and period queries.

Tested: yes.

### Billing Period Events

Owns append-only audit log for period and document transitions.

Tested: yes.

### Billing Documents

Owns shared statement/invoice document creation, editing, issue/void lifecycle, retrieval, and document numbering/display identifiers.

Tested: yes.

### Billing Document Line Items

Owns editable document rows and source traceability.

Tested: yes.

### Time Entry Locking

Owns the canonical predicate for whether an entry can be edited or deleted.

Tested: yes.

### Monthly Close Feed

Builds the cross-project billing/accounting queue for the selected month. Prefer extending the existing Ready/Uninvoiced row-building logic so sidebar counts, invoice readiness, and Monthly Close do not drift.

Tested: yes.

### Close Orchestrators

Separate orchestrators for:

- T&M close
- fixed close
- retainer month close
- rollover month close
- rollover cycle settlement close

Each orchestrator writes periods, links entries, creates documents, and emits events.

Tested: yes.

### Invoice Projection

Filters billing documents into the financial ledger view and owns invoice-specific payment state.

Tested: yes.

## Implementation Notes

- Existing invoice lifecycle remains useful and should be integrated, not discarded.
- Existing invoice line item editing is the model for shared document line item editing.
- Existing retainer report UI and Retainer Usage table are good presentation foundations, but the data source should move from live report queries to stored billing documents.
- Existing `getReadyToInvoiceUnified` logic is close to the desired queue, but it currently excludes zero-amount retainer statement work. Monthly Close must include those rows.
- Monthly Close should be a separate page from `/invoices`.
- `/invoices` remains the financial ledger and payment chase surface.
- Project pages should expose all billing documents by month/period so the owner can retrieve previously issued documents.

## Explicit Non-Goals

- Separate long-term report and invoice document systems.
- Zero-dollar invoices in the financial ledger.
- Project-level date locks as the canonical lock source.
- Fully event-sourced current status. Store current status as a denormalized projection and keep events as audit history.
- Duplicate period concepts long term.
- Document editing that silently mutates source time entries.

## Out of Scope

- Stripe API integration, subscription reconciliation, or webhooks.
- Online payment collection.
- Email sending or auto-send.
- PDF generation service; browser print remains acceptable.
- Credit notes and refund workflows.
- Automatic pro-rating for partial retainer months.
- Full analytics dashboard redesign.
- Historical production data migration.
- Public client portal.

## Testing

Required tests:

- billing period status transitions
- event emission for create, document create, issue, close, reopen, void, and invoice paid
- time entry lock predicate
- T&M selected-entry close leaves unselected entries open
- fixed close snapshots remaining balance and creates/accounting-closes fixed evidence correctly
- fixed entries display accounted/closed state without implying hourly revenue
- retainer no-overage close creates editable statement and locks entries
- retainer overage close creates editable invoice and locks entries
- statement and invoice documents share the same line item/editor model
- document line item edits do not mutate source time entries
- issued documents render from stored line items, not live project/task/category data
- statements are excluded from `/invoices`, unpaid, overdue, and paid metrics
- rollover mid-cycle close creates monthly statement
- rollover final-cycle close creates invoice or statement
- cycle settlement period does not take ownership of earlier month entries
- reopening blocked by issued/paid invoice
- Monthly Close feed emits both invoiceable and zero-amount close rows

Manual verification:

- Monthly Close with mixed T&M, fixed-fee, and retainer projects
- T&M drill-in selection and invoice creation
- fixed remaining-balance invoice creation
- fixed time entries marked accounted through close flow
- no-overage retainer month produces editable statement
- statement line item can be rounded/hidden before issue
- issued statement can be downloaded later from the project/month
- overage retainer month produces invoice with same document layout
- rollover month 1/3 and 2/3 produce statements
- rollover month 3/3 settles the cycle
- `/invoices` shows invoices only, not statements
- reopen requires reason and records event

## Key Invariants

- A billing period is the operational close.
- A billing document is the client-facing artifact.
- Statement and invoice documents share one editor, one line item model, and one renderer.
- A statement is not a payment request and never enters the invoice/payment ledger.
- An invoice is a payment request and does enter the invoice/payment ledger.
- Every non-void draft or closed period locks its linked time entries.
- Document edits do not mutate source time entries.
- Reopen is an event, not a status.
- Time entries should never need multiple contradictory billing-state fields.
