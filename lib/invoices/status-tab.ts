// Shared vocabulary for the invoices list status tab — keeps the URL param,
// the page's data fetching, and the toolbar tab nav in lockstep.
//
// Lifecycle stages — each tab is a single stage, never mixed:
//
//   close       — closable periods across the org (the month-close queue)
//   draft       — invoice exists, not sent
//   outstanding — issued, awaiting payment (overdue is a derived display state)
//   paid        — settled
//   void        — cancelled
//
// `close` is the default landing tab — it's the front door of the month-end
// ritual (replacing the old "Ready" tab, PRD slice 08). There's no `all` tab
// on purpose: mixing pre-issuance queue rows with issued invoices in one list
// mashes two mental modes (action vs ledger) that have no shared use case.
// Cross-status discovery happens via the Filter popover and Search.

export type InvoiceStatusTab =
  | "close"
  | "draft"
  | "outstanding"
  | "paid"
  | "void"

export type InvoiceStatus = "draft" | "invoiced" | "paid" | "void"

// Default landing tab — null/missing/unknown URL param resolves here.
export const DEFAULT_STATUS_TAB: InvoiceStatusTab = "close"

// Maps a tab to the backend invoice status. `close` returns `undefined`
// because the close queue is NOT invoices and is sourced from a different
// query (`close.getCloseQueue`) — the page handles the data wiring.
export const STATUS_TAB_TO_QUERY: Record<
  InvoiceStatusTab,
  InvoiceStatus | undefined
> = {
  close: undefined,
  draft: "draft",
  outstanding: "invoiced",
  paid: "paid",
  void: "void",
}

export const INVOICE_STATUS_TABS: { key: InvoiceStatusTab; label: string }[] = [
  { key: "close", label: "To close" },
  { key: "draft", label: "Draft" },
  { key: "outstanding", label: "Outstanding" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
]

export function parseStatusTab(value: string | null): InvoiceStatusTab {
  return value === "close" ||
    value === "draft" ||
    value === "outstanding" ||
    value === "paid" ||
    value === "void"
    ? value
    : DEFAULT_STATUS_TAB
}

// True when the tab is the month-close queue (not-yet-invoice periods).
export function tabIsClose(tab: InvoiceStatusTab): boolean {
  return tab === "close"
}

// True when the tab includes actual invoice rows (any status). Used by the
// page to decide whether to fetch the invoice list at all.
export function tabIncludesInvoices(tab: InvoiceStatusTab): boolean {
  return tab !== "close"
}
