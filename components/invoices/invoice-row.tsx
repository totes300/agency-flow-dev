"use client"

import Link from "next/link"
import { TableRow, TableCell } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions"
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"
import {
  buildCycleMonths,
  formatCurrency,
  formatInvoiceDate,
  formatInvoiceIdentifier,
  invoiceUrlSegment,
} from "@/lib/format"
import { getYMDInTimezone } from "@/lib/workday"
import type { Id } from "@/convex/_generated/dataModel"
import type {
  DateColumn,
  InvoiceRow as InvoiceRowType,
} from "@/components/invoices/invoice-list"
import type { ReadyRow } from "@/lib/invoices/list-rows"
import { cn } from "@/lib/utils"

// ─── Invoice row ───────────────────────────────────────────────────────────

export function InvoiceRowItem({
  invoice,
  showProject,
  showType,
  showStatus,
  showDate,
  timezone,
  dateColumn,
  selected,
  onSelect,
  onOpen,
}: {
  invoice: InvoiceRowType
  showProject: boolean
  showType: boolean
  showStatus: boolean
  showDate: boolean
  timezone: string
  dateColumn: DateColumn
  selected: boolean
  /**
   * `id` is forwarded for callers that need to track per-id state. The list
   * itself keys selection on a string built from the row, so most callers
   * can ignore the id.
   */
  onSelect: (id: Id<"invoices">, shiftKey: boolean) => void
  onOpen: (invoice: InvoiceRowType) => void
}) {
  const isVoid = invoice.status === "void"

  return (
    <TableRow
      className={cn(
        "group cursor-pointer",
        selected && "bg-muted/40",
        // Void rows read as historical — mute the text so live rows visually
        // dominate the scan. Badge already carries the line-through signal.
        isVoid && "text-muted-foreground",
      )}
      data-selected={selected || undefined}
      onClick={() => onOpen(invoice)}
    >
      <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(invoice._id as Id<"invoices">, false)}
          onClick={(e) => {
            // Reach into the native event for shiftKey — Radix's
            // onCheckedChange doesn't forward the modifier.
            if (e.shiftKey) {
              e.preventDefault()
              onSelect(invoice._id as Id<"invoices">, true)
            }
          }}
          aria-label={`Select invoice ${formatInvoiceIdentifier(invoice.prefix, invoice.number)}`}
        />
      </TableCell>
      <TableCell
        className={invoice.number == null ? "text-muted-foreground" : "font-medium"}
      >
        {invoice.number == null
          ? "—"
          : formatInvoiceIdentifier(invoice.prefix, invoice.number)}
      </TableCell>
      <TableCell className="max-w-0 truncate text-muted-foreground">
        {invoice.subject ?? "—"}
      </TableCell>
      {showProject && (
        <TableCell className="max-w-0 truncate text-muted-foreground">
          {invoice.clientName}
        </TableCell>
      )}
      {showProject && (
        <TableCell className="max-w-0 truncate text-muted-foreground">
          {invoice.projectName}
        </TableCell>
      )}
      {showType && (
        <TableCell>
          <BillingTypeBadge type={invoice.projectBillingType as BillingType} />
        </TableCell>
      )}
      {showStatus && (
        <TableCell>
          <InvoiceStatusBadge
            status={invoice.status}
            dueDate={invoice.dueDate}
            timezone={timezone}
          />
        </TableCell>
      )}
      <TableCell className="text-right font-medium tabular-nums">
        {formatCurrency(invoice.total, invoice.currency)}
      </TableCell>
      {showDate && (
        <TableCell className="text-muted-foreground">
          {dateColumn === "paid"
            ? formatPaidDate(invoice.paidAt, timezone)
            : invoice.dueDate
              ? formatInvoiceDate(invoice.dueDate)
              : "—"}
        </TableCell>
      )}
      <TableCell
        className={cn(
          invoice.status === "paid" ? "w-12" : "w-44",
          "pl-0 text-right",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <InvoiceRowActions
          invoiceId={invoice._id as Id<"invoices">}
          identifier={invoiceUrlSegment(invoice)}
          status={invoice.status}
        />
      </TableCell>
    </TableRow>
  )
}

// ─── Ready row ─────────────────────────────────────────────────────────────

/**
 * Billing-inbox row — same column grammar as `InvoiceRowItem` but rendering
 * pre-issuance state. Number and Due cells em-dash because those values
 * don't exist yet. The Status column carries the readiness pill
 * (within budget / over by Xh / blank for fixed+T&M) — the eye reads the
 * column position consistently with invoice rows below.
 *
 * Three action shapes:
 *   - Generate rows (over-budget retainer, Fixed, T&M) → primary "Generate".
 *   - Close rows (within-budget retainer month/cycle)  → outline
 *     "Close & report", which opens the same review modal the project's
 *     Monthly Breakdown card uses.
 *   - Config-issue rows (over budget, no overage rate) → "Set rate" link to
 *     the project's settings tab; there is nothing billable until the rate
 *     exists, but the pending money must stay visible in the queue.
 */
export function ReadyRowItem({
  row,
  showProject,
  showType,
  showStatus,
  showDate,
  selected,
  onSelect,
  onGenerate,
  onClose,
}: {
  row: ReadyRow
  showProject: boolean
  showType: boolean
  showStatus: boolean
  showDate: boolean
  selected: boolean
  onSelect: (shiftKey: boolean) => void
  onGenerate: () => void
  onClose: () => void
}) {
  const isClose = row.kind === "retainer-close" || row.kind === "retainer-cycle-close"
  return (
    <TableRow
      className={cn("group", selected && "bg-muted/40")}
      data-selected={selected || undefined}
    >
      <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(false)}
          onClick={(e) => {
            if (e.shiftKey) {
              e.preventDefault()
              onSelect(true)
            }
          }}
          aria-label={`Select ready row for ${row.projectName}`}
        />
      </TableCell>
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell className="max-w-0 truncate font-medium">
        {readySubject(row)}
      </TableCell>
      {showProject && (
        <TableCell className="max-w-0 truncate text-muted-foreground">
          {row.clientName}
        </TableCell>
      )}
      {showProject && (
        <TableCell className="max-w-0 truncate text-muted-foreground">
          {row.projectName}
        </TableCell>
      )}
      {showType && (
        <TableCell>
          <BillingTypeBadge type={billingTypeForKind(row.kind) as BillingType} />
        </TableCell>
      )}
      {showStatus && (
        <TableCell>
          <ReadinessBadge row={row} />
        </TableCell>
      )}
      <TableCell
        className={cn(
          "text-right tabular-nums",
          row.amount === 0 ? "text-muted-foreground" : "font-medium",
        )}
      >
        {/* Close rows carry no billable amount — an em-dash reads "nothing
            owed", where $0.00 would read "a zero-value invoice". */}
        {isClose ? "—" : formatCurrency(row.amount, row.currency)}
      </TableCell>
      {showDate && <TableCell className="text-muted-foreground">—</TableCell>}
      <TableCell
        className="w-44 pl-0 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <ReadyRowAction row={row} onGenerate={onGenerate} onClose={onClose} />
      </TableCell>
    </TableRow>
  )
}

function ReadyRowAction({
  row,
  onGenerate,
  onClose,
}: {
  row: ReadyRow
  onGenerate: () => void
  onClose: () => void
}) {
  if (row.kind === "retainer-close" || row.kind === "retainer-cycle-close") {
    return (
      <Button size="sm" variant="outline" onClick={onClose}>
        Close &amp; report
      </Button>
    )
  }
  if (row.configIssue === "missing-overage-rate") {
    return (
      <Button size="sm" variant="outline" asChild>
        <Link href={`/projects/${row.projectId}?tab=settings`}>Set rate</Link>
      </Button>
    )
  }
  return (
    <Button size="sm" onClick={onGenerate}>
      Generate
    </Button>
  )
}

function formatPaidDate(paidAt: number | undefined, timezone: string): string {
  if (paidAt == null) return "—"
  return formatInvoiceDate(getYMDInTimezone(new Date(paidAt), timezone))
}

function ReadinessBadge({ row }: { row: ReadyRow }) {
  // Fixed and T&M intentionally have no badge — the cell stays empty so the
  // column reads as a status slot, not a "needs filler" column.
  if (row.badgeKind === null) return null
  if (row.badgeKind === "within-budget") {
    return <ColoredPillBadge tone="green" label="within budget" />
  }
  if (row.configIssue === "missing-overage-rate") {
    return <ColoredPillBadge tone="amber" label="no overage rate" />
  }
  // over-budget: pill carries hours, e.g. "2h over". One concrete number is
  // intentional here (the user wants to know magnitude before clicking).
  const hours = row.overageHours ?? 0
  const display =
    hours >= 1
      ? `${Math.round(hours * 10) / 10}h over`
      : `${Math.round(hours * 60)}m over`
  return <ColoredPillBadge tone="amber" label={display} />
}

function billingTypeForKind(kind: ReadyRow["kind"]): string {
  switch (kind) {
    case "retainer-monthly":
    case "retainer-cycle":
    case "retainer-close":
    case "retainer-cycle-close":
      return "retainer"
    case "fixed":
      return "fixed"
    case "tm":
      return "t_and_m"
  }
}

function readySubject(row: ReadyRow): string {
  if (row.kind === "retainer-monthly" && row.period) {
    return `${monthLong(row.period)} overage`
  }
  if (row.kind === "retainer-cycle" && row.period) {
    return `${cycleSubjectLabelFor(row)} overage`
  }
  // Close rows: the deliverable is the Monthly Report, not an invoice — the
  // subject says so, since the Status pill column is hidden on the Ready tab.
  if (row.kind === "retainer-close" && row.period) {
    return `${monthLong(row.period)} report — within budget`
  }
  if (row.kind === "retainer-cycle-close" && row.period) {
    return `${cycleSubjectLabelFor(row)} report — within budget`
  }
  if (row.kind === "tm" && row.period) {
    return monthLong(row.period)
  }
  return "Fixed fee"
}

function monthLong(p: { year: number; month: number }): string {
  return new Date(p.year, p.month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

function monthShort(p: { year: number; month: number }): string {
  return new Date(p.year, p.month - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  })
}

function cycleSubjectLabelFor(row: ReadyRow): string {
  if (!row.period) return ""
  const cycleLen = row.cycleLengthMonths
  // Single-month cycles read as a plain month, not a degenerate range
  // ("June 2026", never "Jun-Jun 2026").
  if (!cycleLen || cycleLen <= 1) return monthLong(row.period)
  const months = buildCycleMonths(row.period.year, row.period.month, cycleLen)
  const first = months[0]
  const last = months[months.length - 1]
  if (!first || !last) return monthLong(row.period)
  if (first.year === last.year)
    return `${monthShort(first)}-${monthShort(last)} ${last.year}`
  return `${monthShort(first)} ${first.year}-${monthShort(last)} ${last.year}`
}
