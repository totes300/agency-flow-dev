# Tasks for Issue 4: Invoice Lifecycle — Status Transitions, Read-Only Mode, Delete

Parent issue: docs/invoicing-issues.md — Issue 4
Parent PRD: docs/invoicing-prd.md

## Tasks

### 1. Add `changeInvoiceStatus` mutation

**Type**: WRITE
**Output**: `convex/invoices.ts` exports `changeInvoiceStatus` with all 4 valid transitions
**Depends on**: none

Add a state machine mutation to `convex/invoices.ts`. Valid transitions: `draft → invoiced` (set status), `invoiced → paid` (set status + `paidAt` timestamp), `invoiced → draft` (revert), `paid → invoiced` (clear `paidAt`). No direct `paid → draft` path. Requires admin via `requireAdmin(ctx)`. Throws `ConvexError` on invalid transitions.

**Status**: ✅ Complete

---

### 2. Add `deleteInvoice` mutation

**Type**: WRITE
**Output**: `convex/invoices.ts` exports `deleteInvoice` that clears `invoiceId` from entries, deletes line items, deletes invoice
**Depends on**: none

Critical order: (1) unlink time entries by iterating all line items' `timeEntryIds` and clearing `invoiceId`, (2) delete all line items, (3) delete the invoice. This order prevents losing entry references. Retainer LIFO guard: for finalized (non-draft) retainer invoices, check for later finalized invoices on the same project by comparing `periodEnd` dates. Throw `"Delete the [Month Year] invoice first."` if blocked. Drafts always bypass LIFO. Draft invoices don't count as blockers either.

**Status**: ✅ Complete

---

### 3. Wire sidebar action buttons

**Type**: WRITE
**Output**: `InvoiceSidebar` shows correct buttons per status with confirmation dialogs
**Depends on**: 1, 2

Replace the placeholder in `components/invoices/invoice-sidebar.tsx`. Draft: "Mark as Invoiced" (Primary, ConfirmDialog). Invoiced: "Mark as Paid" (outline, no dialog — direct call + toast), "Revert to Draft" (ghost, ConfirmDialog). Paid: "Revert to Invoiced" (ghost, ConfirmDialog). All states: "Delete Invoice" (destructive, ConfirmDialog). Post-delete: `router.replace(backHref)` where `backHref` is derived from `?from=` params (passed as prop from page). LIFO failure: `toast.error` from `toastError`. Added `backHref` prop to sidebar, updated page to pass it.

**Status**: ✅ Complete

---

### 4. Read-only mode — locked banner + static rendering

**Type**: WRITE
**Output**: Non-draft invoices show locked banner, all fields render as static text
**Depends on**: 3

Added locked banner with `LockIcon` at top of `InvoiceDocument` when `readOnly`: "This invoice is locked. Revert to draft to make changes." Muted background, informational style. Audited all editable fields: subject, issue/due dates, note, work breakdown cells — all already switch to non-focusable static `<span>`/`<p>` elements when `readOnly`. Add/remove buttons hidden. No disabled opacity on document area.

**Status**: ✅ Complete

---

### 5. First-time brand info nudge banner

**Type**: WRITE
**Output**: Inline dismissable banner on editor when org's first invoice + incomplete brand info
**Depends on**: 3

Added `orgInvoiceCount` to `getInvoice` query response. On the editor page, when `orgInvoiceCount <= 1` and brand name or address is missing, show an inline banner: "Complete your agency details in Settings for professional invoices." Blue informational style with link to `/settings`. Dismissable via `useState` (session-scoped). Uses `XIcon` close button.

**Status**: ✅ Complete

---

### 6. TypeScript verification

**Type**: REVIEW
**Output**: `npx tsc --noEmit` passes with 0 errors
**Depends on**: 4, 5

**Status**: ✅ Complete — 0 errors
