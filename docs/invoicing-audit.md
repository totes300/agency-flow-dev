# Audit Report: Invoicing

Parent PRD: `docs/invoicing-prd.md` (9 issues, all shipped)
Date: 2026-04-17
Files in scope: ~35 (5 Convex + 2 routes + 16 invoice components + 4 project-time components + 1 settings component + 3 lib + 4 modified components/pages)

---

## Summary

The invoicing feature is **functionally complete and safe to leave in production**, but it has three **Critical** issues that should be fixed before users create many real invoices — most importantly the **Fixed-fee "already invoiced" bug** that can double-bill a project after a draft is deleted, and the **editable-when-it-shouldn't-be `retainer_fee` / `fixed` / `overage` line items** that silently desync invoice math from snapshot fields. Supporting issues around tenancy hardening, UI shared-component reuse, and derived-state effects are cosmetic but numerous and cluster around the same AI-written patterns. Backend correctness is strong: retainer math is centralized, OCC is used correctly, transactions are atomic, error messages are user-readable. The UI ships real shadcn primitives (`<Table>`, `<MetricCard>`, `<EmptyState>`, `<ConfirmDialog>`) in the most important places; the gaps are in smaller hand-rolled widgets (tabs, pills, textareas, inline-edit, banners).

---

## Critical findings

### 1. Fixed-fee "remaining" calculation includes DRAFT invoices — can double-bill a project

**Location**: `convex/invoices.ts:1335-1356` (and mirrored in `getInvoicePreview:454-470`, `getProjectInvoiceMetrics:320-332`, `getInvoice:1526-1544`)
**Category**: Logic
**Problem**: When a new Fixed-fee invoice is created, `alreadyInvoiced = Σ lineType:"fixed".amount` sums over **every** project invoice, including drafts. Scenario: create Draft A at €5,000 of a €10,000 project → `remaining = €5,000`. Create Draft B using that remaining → B is a snapshot at €5,000. Delete Draft A. The next invoice now sees `alreadyInvoiced = €5,000` (from B only) → pre-fills `remaining = €5,000` again. Total billed becomes €15,000 on a €10,000 project. The sidebar "Invoiced: €X / €Y" progress indicator suffers the same drift.
**Suggestion**: Filter to finalized invoices only: `if (inv.status !== "draft") ...` in all four call sites. Alternatively, tag drafts as "pending" in the progress display so the user understands what's in-flight.

### 2. `updateInvoiceLineItem` lets admins edit `retainer_fee`, `fixed`, and `overage` rows — corrupts invoice math

**Location**: `convex/invoices.ts:1622-1696`
**Category**: Logic / Validation
**Problem**: `removeInvoiceLineItem` (line 1766) correctly guards these line types, but `updateInvoiceLineItem` does not. An admin can set `retainer_fee.unitPrice = 0` on a draft — `recalcRetainerBalance` will rebuild `subtotal` from the zeroed row, but `invoice.retainerMonthlyFee` snapshot keeps the original value. Totals, sidebar progress, and metrics will disagree with the snapshot. Same risk for overriding `fixed.amount` on a Fixed invoice — the project progress calc pulls from the line item, which the user silently edited outside the "remaining balance" rule.
**Suggestion**: Mirror the guard from `removeInvoiceLineItem`: reject edits where `lineItem.lineType` is `"fixed" | "retainer_fee" | "overage"`. Only `"time"` and `"manual"` rows should be freely editable.

### 3. Retainer revert-to-draft guard ignores later DRAFT invoices — breaks balance chain

**Location**: `convex/invoices.ts:1827-1901` (`findLaterFinalizedRetainerInvoice` + `changeInvoiceStatus`)
**Category**: Logic / State machine
**Problem**: Revert guard only blocks when a later *finalized* retainer invoice exists. But when March is finalized, an April draft may have already been created — its `retainerStartBalanceMinutes` was snapshotted from March's `retainerEndBalanceMinutes`. Reverting March unfreezes that end-balance; April's draft keeps its stale snapshot, and if the user edits March's hours, April silently diverges. The `recalcRetainerBalance` flow on edit doesn't cascade to sibling drafts. Same concern for `deleteInvoice` LIFO — drafts downstream of the deleted invoice aren't cleaned up.
**Suggestion**: Either (a) block revert/delete when any later retainer invoice (draft included) exists, telling the user to delete/revert the downstream draft first, or (b) on successful revert, automatically recompute `retainerStartBalanceMinutes` on any later drafts for the same project.

---

## High findings

### 4. `amountOverridden` flag can never be cleared

**Location**: `convex/invoices.ts:1660-1672`
**Category**: Logic
**Problem**: Once set, the flag sticks forever. Further quantity/rate edits won't recompute `amount`. A user who edits amount back to `qty × price` then changes hours will see the old overridden amount. There's no explicit reset path, and `lineType: "time"` lines (where this matters most) can't be deleted and re-added.
**Suggestion**: When `args.amount !== undefined && args.amount === round2(qty × price)`, clear `amountOverridden`. Alternative: expose a separate "reset to calculated" mutation.

### 5. List/Preview/Metrics queries are member-accessible — admin-only UI isn't the last line of defense

**Location**: `convex/invoices.ts` — `listInvoices`, `listAllInvoices`, `getInvoiceMetrics`, `getReadyToInvoice`, `getProjectInvoiceMetrics`, `getInvoicePreview`, `getRetainerInvoicePreview`, `getRetainerUninvoicedMonths`
**Category**: Authorization
**Problem**: All mutations use `requireAdmin(ctx)` (good). But these queries use `getAuthContext` — any org member hitting the Convex API directly can enumerate invoices, retainer month balances, and preview amounts. PRD declares invoicing admin-only; route-access enforces this at the page level. Without server gating, a non-admin member can still read invoice state via the generated API. Note: `getInvoice` IS admin-gated — so the guardrail exists but is inconsistently applied.
**Suggestion**: Switch all eight queries to `requireAdmin`. This matches `getInvoice` and the mutations.

### 6. `getInvoice` category lookup not tenancy-guarded (defense-in-depth)

**Location**: `convex/invoices.ts:1471-1475`
**Category**: Security / Tenancy
**Problem**: `ctx.db.get(catId)` on `workCategoryId` from a line item does not verify `cat.orgId === orgId`. Line items are orgId-scoped on insert so practical risk is low, but CLAUDE.md says "every query/mutation MUST filter by orgId… no exceptions." If a malformed or migrated row ever references a cross-tenant category, the name/color leaks. Same pattern may exist in a handful of other `ctx.db.get(...)` calls in this file.
**Suggestion**: `if (cat && cat.orgId === orgId) categoryMap.set(...)`.

### 7. Undocumented sequential creation guard rejects legitimate drafting

**Location**: `convex/invoices.ts:1054-1086`
**Category**: Consistency / UX
**Problem**: Code comment says "BUG FIX: Sequential guard — reject if previous months in the same cycle are not yet finalized." This blocks creating April's draft while March is still a draft (rollover ON). The PRD defines only (a) project-month uniqueness and (b) LIFO deletion — it does NOT require sequential finalization. Blocking draft creation prevents a common admin workflow (prepare multiple months in parallel, then finalize). It's also stricter than the revert/delete guards, which use finalized-only checks.
**Suggestion**: Either document this invariant in the PRD (and verify it's what users want), or relax to: "if the previous month has NO invoice at all, block; if it has a draft, allow."

### 8. `updateInvoice` has no date validation

**Location**: `convex/invoices.ts:1587-1615`
**Category**: Validation
**Problem**: `issueDate` and `dueDate` accept any string — "yesterday", "not-a-date", or `dueDate < issueDate`. Downstream code does lexicographic string compare (`dueDate >= today`) in `getInvoiceMetrics`, which breaks silently on malformed input.
**Suggestion**: Validate `/^\d{4}-\d{2}-\d{2}$/` on both, parse/verify they're real dates, and reject `dueDate < issueDate`. Mirror the pattern in `timeEntries.create:204-208`.

---

## Medium findings

### 9. Page file contains an inline component definition

**Location**: `app/(dashboard)/invoices/[id]/page.tsx:16-42`
**Category**: Best practices (CLAUDE.md rule)
**Problem**: `EditorSkeleton` is defined inline in the page file. CLAUDE.md: "A page.tsx must NEVER contain inline component definitions."
**Suggestion**: Move to `components/invoices/invoice-editor-skeleton.tsx`. Match the pattern of `invoices-page-skeleton.tsx`.

### 10. First-time brand nudge is hand-rolled JSX instead of shadcn `<Alert>`

**Location**: `app/(dashboard)/invoices/[id]/page.tsx:94-111`
**Category**: Consistency / shadcn reuse
**Problem**: Hardcoded `border-blue-200 bg-blue-50` inline instead of shadcn `<Alert>` (`components/ui/alert.tsx`). Also defined in the page file instead of extracted.
**Suggestion**: Extract to `components/invoices/invoice-brand-nudge.tsx` and use `<Alert>` with dismissable close. Same pattern applicable to inline error banners in `create-invoice-modal.tsx:437-439` and `settings-invoicing.tsx:193-195`.

### 11. Hand-rolled tabs + pills instead of shadcn primitives

**Location**: `components/invoices/invoices-filters.tsx:92-113` (status tabs), `components/invoices/create-invoice-modal.tsx:272-288` (date preset pills)
**Category**: shadcn reuse
**Problem**: Custom `<button>` + underline/pill styling for what `<Tabs variant="line">` and `<ToggleGroup>` already ship (used in settings/projects). Also misses built-in a11y states.
**Suggestion**: Replace with `<Tabs>` (URL-synced) for filter tabs and `<ToggleGroup type="single">` for presets.

### 12. Hand-rolled inline-edit duplicated across three files

**Location**: `components/invoices/editable-cells.tsx` (EditableTextCell + EditableNumberCell), `components/invoices/invoice-document.tsx:52-73, 122-144` (subject), `components/invoices/invoice-sidebar.tsx:36-61, 142-150` (note)
**Category**: Duplication (CLAUDE.md rule)
**Problem**: Same click-to-edit / Enter / Escape / blur-save pattern implemented four times. CLAUDE.md says "Same interaction pattern across pages = shared hook + shared atom."
**Suggestion**: Extract `lib/hooks/use-inline-edit.ts` and shared `<InlineEditText>` / `<InlineEditNumber>` atoms. Mirror existing `use-inline-add` pattern.

### 13. Note textarea is a raw `<textarea>`, not shadcn `<Textarea>`

**Location**: `components/invoices/invoice-sidebar.tsx:142-150`
**Category**: shadcn reuse
**Problem**: Hand-rolled `<textarea>` with manual classes instead of `components/ui/textarea.tsx`, losing consistent focus ring / placeholder / a11y behavior.
**Suggestion**: Replace with `<Textarea>`.

### 14. `EmptyStateBanner` defined inline in project-time feature file

**Location**: `components/projects/project-time.tsx:54-77`
**Category**: Shared component reuse
**Problem**: Duplicates `components/empty-state.tsx` with slightly different layout (bordered banner). Three call sites in the same file.
**Suggestion**: Add a `variant="banner"` prop to the shared `<EmptyState>` and use it here.

### 15. Domain status badges inline in time table

**Location**: `components/projects/project-time-table.tsx:189-194, 215-219`
**Category**: Domain UI atoms (CLAUDE.md rule)
**Problem**: "Non-billable" and "Uninvoiced" pills hand-coded inline — CLAUDE.md: "Any visual representation of a domain concept must be a shared component."
**Suggestion**: Create `components/billing-status-badge.tsx` covering `invoiced | uninvoiced | non-billable` states (same styling language as `InvoiceStatusBadge`).

### 16. `useEffect` to sync filter state from URL — derived-state anti-pattern

**Location**: `components/invoices/invoices-filters.tsx:79-81`, `components/projects/project-time-filters.tsx:78-80`
**Category**: React best practices (CLAUDE.md rule)
**Problem**: `useEffect(() => { setSearchInput(urlSearch) }, [urlSearch])` is a sync loop. CLAUDE.md: "Never use useEffect to set stateB when stateA changes."
**Suggestion**: Use compare-in-render pattern (already done correctly in `project-time.tsx:115-120`).

### 17. Duplicated date + format helpers

**Location**: `components/invoices/invoice-document.tsx:15-27` and `components/invoices/create-invoice-modal.tsx:77-89` (`dateToString` / `stringToDate`); `components/invoices/invoice-billing-summary.tsx:19-23` (`formatMinutesAsHours`)
**Category**: CLAUDE.md rule ("helpers go in `lib/`")
**Problem**: Same functions defined in multiple files.
**Suggestion**: Move to `lib/format.ts` (or a new `lib/date.ts`).

### 18. N+1 read pattern in list queries

**Location**: `convex/invoices.ts:65-78, 128-142, 184-203, 308-332`
**Category**: Performance
**Problem**: `listInvoices` / `listAllInvoices` do `ctx.db.get(projectId)` and `ctx.db.get(clientId)` per invoice. At 100 invoices = 200 individual fetches. `getInvoiceMetrics` walks every invoice per page load.
**Suggestion**: Dedupe project/client IDs and fetch unique ones once. Consider `by_orgId_projectId` and `by_orgId_clientId` compound indexes on `invoices` to avoid collecting-then-filtering.

### 19. `addInvoiceLineItem` has no per-invoice cap

**Location**: `convex/invoices.ts:1701-1740`
**Category**: Validation
**Problem**: Admins (including a compromised session or scripted bot) can spam-create thousands of manual rows, inflating the invoice doc.
**Suggestion**: Cap at 500 line items per invoice. Count existing before insert.

---

## Low findings

### 20. Error message inconsistency

**Location**: Throughout `convex/invoices.ts`
**Category**: Consistency
**Problem**: Mixed terminal punctuation and capitalization: `"Invoice not found"` (no period), `"An invoice for March 2026 already exists."` (period), `"Only draft invoices can be edited"` (no period).
**Suggestion**: Pick one convention (sentence case + trailing period is most common) and apply globally.

### 21. Hand-rolled row-remove buttons duplicated

**Location**: `components/invoices/invoice-work-breakdown.tsx:154-162, 207-215`, `components/invoices/invoice-billing-summary.tsx:127-132`
**Category**: Duplication
**Problem**: Same `invisible group-hover:visible` remove-row icon button repeated three times.
**Suggestion**: Extract `<RowRemoveButton>` atom.

### 22. Debounced search-to-URL logic duplicated

**Location**: `components/invoices/invoices-filters.tsx:43-90`, `components/projects/project-time-filters.tsx:47-90`
**Category**: Duplication
**Problem**: Two copies of `useState(urlSearch)` + 250ms debounce + URL-sync effect.
**Suggestion**: Extract `lib/hooks/use-debounced-search-param.ts`.

### 23. `<hr>` used instead of shadcn `<Separator>`

**Location**: `components/invoices/create-invoice-modal.tsx` (multiple), `components/invoices/invoice-billing-summary.tsx:100, 152`, `components/invoices/invoice-document.tsx:196`
**Category**: shadcn reuse
**Problem**: Raw `<hr className="border-border" />` instead of `<Separator>` (which is already imported in `project-time-selection-toolbar.tsx`).
**Suggestion**: Replace with `<Separator />`.

### 24. Ready-to-invoice card uses hand-rolled collapse

**Location**: `components/invoices/ready-to-invoice-card.tsx:48-63`
**Category**: shadcn reuse
**Problem**: Custom button+chevron toggle re-implements `<Collapsible>` (already in `components/ui/collapsible.tsx`), losing a11y attributes.
**Suggestion**: Use `<Collapsible>` / `<CollapsibleTrigger>` / `<CollapsibleContent>`.

### 25. Skeleton rows are generic boxes

**Location**: `components/invoices/invoices-page-skeleton.tsx:14-32`
**Category**: CLAUDE.md rule (content-aware skeletons)
**Problem**: Skeleton tab strip renders as four rounded blocks while real tabs are underlined text; skeleton rows are 48px flat boxes without column structure.
**Suggestion**: Mirror real table columns (number, subject, type, status, total, dates) as col-width stripes; mirror underlined-tab shape.

### 26. Recalc rounds `quantity × 60` on each time line item

**Location**: `convex/invoices.ts:671-673`
**Category**: Logic
**Problem**: `Math.round(item.quantity * 60)` on user-edited fractional hours can drift ±1 min per line. Accumulates across many rows. Passing `roundingMinutes: 0` mitigates most of this, but still susceptible.
**Suggestion**: Either store minutes directly on time line items (add a `quantityMinutes` field) or document the tolerance explicitly.

### 27. `InvoiceStatusBadge` duplicates styling language of `StatusBadge`

**Location**: `components/invoices/invoice-status-badge.tsx`
**Category**: Duplication
**Problem**: Both use the same tint + dot + `color-mix` pattern but live in separate files with ~50 lines of near-identical styling logic.
**Suggestion**: Have `InvoiceStatusBadge` be a thin wrapper that maps `invoice.status` → color variant and delegates to shared `StatusBadge`.

### 28. Form-error inline `<p className="text-destructive">` instead of `<Alert>`

**Location**: `components/invoices/create-invoice-modal.tsx:437-439`, `components/settings/settings-invoicing.tsx:193-195`
**Category**: Consistency
**Problem**: Raw destructive text lines for errors — elsewhere the app uses `<Alert variant="destructive">`.
**Suggestion**: Standardize on `<Alert>`.

---

## No findings

The following categories came up clean:

- **Core tenancy**: Every invoice table query uses `.filter(q.eq("orgId", orgId))` or walks an `orgId`-prefixed index. The one defense-in-depth gap (finding #6) is not an active leak.
- **Admin-gated mutations**: All twelve mutations go through `requireAdmin`.
- **Transaction atomicity**: `createInvoice` and `deleteInvoice` perform multi-step writes in a single mutation — Convex guarantees all-or-nothing.
- **OCC for unique numbers**: `nextInvoiceNumber` read-then-increment is safe under concurrent creates (Convex retries one).
- **Shared atoms in critical spots**: `<Table>`, `<MetricCard>`, `<EmptyState>`, `<ConfirmDialog>`, `<BillingTypeBadge>` are all reused. `invoice-list.tsx`, `invoices-metric-cards.tsx`, `project-invoices-empty.tsx` are the canonical examples.
- **URL state for filters**: Invoices page (`status`, `clientId`, `projectId`, `search`) + Project Time tab both persist filter state in URL.
- **Error handling on mutations**: Every `useMutation` call site in the editor (`invoice-sidebar.tsx`, `invoice-work-breakdown.tsx`, `invoice-billing-summary.tsx`) wraps in try/catch with `toastError`.
- **Three-phase render**: `app/(dashboard)/invoices/page.tsx` follows loading → empty → content cleanly.
