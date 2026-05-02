// Shared vocabulary for the invoices list status tab — keeps the URL param,
// the page's data fetching, and the toolbar tab nav in lockstep.
//
// Lifecycle stages — each tab is a single stage, never mixed:
//
//   ready       — project work that has no invoice yet (pre-issuance)
//   draft       — invoice exists, not sent
//   outstanding — issued, awaiting payment (overdue is a derived display state)
//   paid        — settled
//   void        — cancelled
//
// `ready` is the default landing tab — it's where the agency owner does
// work. There's no `all` tab on purpose: mixing pre-issuance rows with
// issued invoices in one list mashes two mental modes (action vs ledger)
// that have no shared use case. Cross-status discovery happens via the
// Filter popover and Search.

export type InvoiceStatusTab =
  | "ready"
  | "draft"
  | "outstanding"
  | "paid"
  | "void"

export type InvoiceStatus = "draft" | "invoiced" | "paid" | "void"

// Default landing tab — null/missing/unknown URL param resolves here.
export const DEFAULT_STATUS_TAB: InvoiceStatusTab = "ready"

// Maps a tab to the backend invoice status. `ready` returns `undefined`
// because ready rows are NOT invoices and are sourced from a different
// query — the page handles the data wiring.
export const STATUS_TAB_TO_QUERY: Record<
  InvoiceStatusTab,
  InvoiceStatus | undefined
> = {
  ready: undefined,
  draft: "draft",
  outstanding: "invoiced",
  paid: "paid",
  void: "void",
}

export const INVOICE_STATUS_TABS: { key: InvoiceStatusTab; label: string }[] = [
  { key: "ready", label: "Ready" },
  { key: "draft", label: "Draft" },
  { key: "outstanding", label: "Outstanding" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
]

export function parseStatusTab(value: string | null): InvoiceStatusTab {
  return value === "ready" ||
    value === "draft" ||
    value === "outstanding" ||
    value === "paid" ||
    value === "void"
    ? value
    : DEFAULT_STATUS_TAB
}

// True when the tab includes ready (not-yet-invoice) rows.
export function tabIncludesReady(tab: InvoiceStatusTab): boolean {
  return tab === "ready"
}

// True when the tab includes actual invoice rows (any status). Used by the
// page to decide whether to fetch the invoice list at all.
export function tabIncludesInvoices(tab: InvoiceStatusTab): boolean {
  return tab !== "ready"
}
