# Billing Badge — Time Entry Billing Status Indicator

> **Goal**: Add `invoiceId` field to time entries + show "Unbilled" badge on billable time entry rows across the app. 
> **This is the first building block of invoicing — everything else in `docs/invoicing-prd.md` builds on this.**
> **Forward-compatible**: Reviewed against the full invoicing PRD to ensure zero rework when invoice CRUD ships.

---

## Context

The invoicing PRD (`docs/invoicing-prd.md`) defines `invoiceId` on time entries as the marker for "this entry was included in an invoice's scope." This task adds that field to the schema and shows a visual "Unbilled" indicator on billable entries that haven't been invoiced yet. No invoice CRUD, no "Billed" badge yet — that ships with invoice creation.

---

## Forward-Compatibility Notes

These decisions were validated against `docs/invoicing-prd.md` to prevent conflicts:

| Decision | Why |
|----------|-----|
| **No `invoices` stub table** | The invoicing PRD says new tables start empty and need no migration (line 715). Creating a stub with fewer fields risks orphaned rows when the full schema ships. Instead, `invoiceId` is typed as `v.optional(v.string())` for now — the invoicing PRD phase will widen it to `v.id("invoices")`. |
| **Remove edit/delete guards, don't rename them** | The invoicing PRD explicitly says: "Time entries stay editable after invoicing. The invoice is the historical record, not the entry." (line 31, 423). The old `invoicedInReportId` guards were wrong — delete them entirely. |
| **Badge only shows "Unbilled", never "Billed"** | `invoiceId` can point to a draft invoice — that's not truly "billed". The correct "Billed" state depends on `invoice.status` (draft/invoiced/paid), which requires a join. That badge ships with invoice CRUD. For now: billable + no invoiceId = "Unbilled". Billable + has invoiceId = no badge (neutral). |
| **`bulkUpdateBillable` still skips invoiced entries** | Unlike edit/delete, changing billable status on an invoiced entry would break the invoice snapshot's financial consistency. This guard stays. |

---

## Scope — What to Build

### 1. Schema: `invoiceId` on `timeEntries`

Add one field to the existing `timeEntries` table in `convex/schema.ts`:

```typescript
invoiceId: v.optional(v.string())   // will become v.id("invoices") when invoices table ships
```

Place it after `snapshotCategoryId`, before `createdAt`. No index needed yet — queries filter by `isBillable` first, then check `invoiceId` presence in memory.

**Why `v.string()` and not `v.id("invoices")`?** There is no `invoices` table yet. Creating a stub table with partial fields risks orphaned test rows that won't match the full schema later. A plain string is safe — the invoicing phase will add the table and widen this field.

### 2. Backend: Remove edit/delete guards on invoiced entries

The invoicing PRD says time entries remain editable after invoicing (the invoice is a snapshot). Remove the old proactive guards entirely:

**a) `update` mutation (~line 293-298) — DELETE this block:**
```typescript
// DELETE ENTIRELY:
if ("invoicedInReportId" in entry && entry.invoicedInReportId) {
  throw new ConvexError("Cannot edit an invoiced time entry");
}
```

**b) `remove` mutation (~line 378-383) — DELETE this block:**
```typescript
// DELETE ENTIRELY:
if ("invoicedInReportId" in entry && entry.invoicedInReportId) {
  throw new ConvexError("Cannot delete an invoiced time entry");
}
```

**c) `bulkUpdateBillable` mutation (~line 449) — KEEP but rename:**
```typescript
// BEFORE:
if ("invoicedInReportId" in entry && entry.invoicedInReportId) continue;

// AFTER:
if (entry.invoiceId) continue;
```

This guard stays because changing billable status on an invoiced entry would break the invoice's financial snapshot.

### 3. Backend: Update `projectOverview` uninvoiced calculation

In `convex/timeEntries.ts`, the `projectOverview` query (~line 560-568) has a "pre-invoicing" comment treating all billable entries as uninvoiced. Replace with actual invoice-aware filtering:

```typescript
// BEFORE:
// NOTE: Pre-invoicing phase — all billable entries treated as uninvoiced.
// Replace with invoice-aware filtering when invoicedInReportId ships.
if (e.isBillable) {
  uninvoicedMinutes += e.durationMinutes;
  uninvoicedAmount += (e.durationMinutes / 60) * (e.billableRate ?? 0);
}

// AFTER:
if (e.isBillable && !e.invoiceId) {
  uninvoicedMinutes += e.durationMinutes;
  uninvoicedAmount += (e.durationMinutes / 60) * (e.billableRate ?? 0);
}
```

### 4. Frontend: `BillingStatusBadge` component

Create `components/invoices/billing-status-badge.tsx` — a shared domain component (per CLAUDE.md conventions).

**Design:** Follow the existing `BillingTypeBadge` pattern (`components/billing-type-badge.tsx`) — minimal pill badge with `data-slot`, `cn()`, no emoji.

**Single visible state:**

| Condition | Render |
|-----------|--------|
| `isBillable && !invoiceId` | **"Unbilled"** — muted text, subtle border (same style as `BillingTypeBadge`) |
| `isBillable && !!invoiceId` | `null` — no badge. The full billing status (Draft/Invoiced/Paid) ships with invoice CRUD. |
| `!isBillable` | `null` — non-billable entries don't get a billing badge. |

**Props:**
```typescript
type Props = {
  isBillable: boolean
  invoiceId?: string | null
  className?: string
}
```

### 5. Frontend: Add badge to time entry rows

Add the `BillingStatusBadge` to every place time entries are rendered. The badge appears next to the existing billable dot indicator.

**a) `components/tasks/time-entries-table.tsx`** — View mode rows (~line 230 area). Add badge after the billable dot, before the duration. Only in view mode, not edit mode.

**b) `components/time/time-entries-list.tsx`** — Compact list entries (~line 80 area). Add badge after the billable dot.

**c) `components/my-time/today-entries.tsx`** — My Time page entries (~line 68 area). Add badge after the billable dot.

**Type updates:** Each component has a local `TimeEntry` type. Add `invoiceId?: string` to each (it comes from the Convex query as part of the document).

No new queries needed — `invoiceId` is already part of the document and will be returned automatically by existing queries once added to the schema.

---

## What NOT to Build

- No `invoices` table (ships with invoice CRUD)
- No `invoiceLineItems` table
- No "Billed" badge state (requires invoice status join — ships with invoice CRUD)
- No org settings additions (prefix, numbering, payment terms)
- No invoice list page or editor page
- No CreateInvoiceModal
- No new API queries or mutations beyond the changes listed above
- No invoice-aware filtering UI (filters, tabs)
- No changes to the Phase 7 time tracking PRD doc

---

## Testing

### Visual verification

1. Run `npx convex dev` + `npm run dev`
2. Navigate to any project > Tasks > open a task > Time tab
3. All billable time entries should show an **"Unbilled"** badge
4. Non-billable entries should NOT show the badge (only the gray dot)
5. Check `/my-time` — same badge appears on today's entries
6. Check the compact time entries list — badge appears there too

### Guard removal verification

1. Edit a time entry's duration or note — should work regardless of `invoiceId` value
2. Delete a time entry — should work regardless of `invoiceId` value
3. Bulk-update billable status on a task — entries WITH `invoiceId` set should be skipped (unchanged), entries without should update normally

### projectOverview verification

1. On a T&M project overview, check the "Uninvoiced" metric card
2. Via Convex dashboard, manually set `invoiceId` to any string (e.g. `"test"`) on a billable entry
3. The "Uninvoiced" amount should decrease by that entry's `hours × billableRate`

### TypeScript verification

Run `npx tsc --noEmit` — must be 0 errors.

---

## Files to Modify

| File | Change |
|------|--------|
| `convex/schema.ts` | Add `invoiceId: v.optional(v.string())` to `timeEntries` |
| `convex/timeEntries.ts` | Remove 2 guard blocks + rename 1 guard + update `projectOverview` uninvoiced filter |
| `components/invoices/billing-status-badge.tsx` | **NEW** — shared badge component |
| `components/tasks/time-entries-table.tsx` | Add `BillingStatusBadge` to view mode rows |
| `components/time/time-entries-list.tsx` | Add `BillingStatusBadge` to list entries |
| `components/my-time/today-entries.tsx` | Add `BillingStatusBadge` to today's entries |

**Total: 4 modified files + 1 new file**

---

## What Changes When Full Invoicing Ships

When `docs/invoicing-prd.md` is implemented later, these changes happen on top of this work:

1. `invoiceId` type widens from `v.optional(v.string())` to `v.optional(v.id("invoices"))`
2. `BillingStatusBadge` gains "Billed" state (joins invoice to read `status`)
3. The `invoices` and `invoiceLineItems` tables are created with full schemas
4. No data migration needed — existing entries with `invoiceId === undefined` are simply uninvoiced

---

## After Implementation

When all changes are done, tested, and committed — ask the user if you should add a "Pre-work done" section to the top of `docs/invoicing-prd.md` summarizing what was already implemented by this task (schema changes, removed guards, badge component, etc.) so the next session working on the full invoicing PRD knows what's already in place.
