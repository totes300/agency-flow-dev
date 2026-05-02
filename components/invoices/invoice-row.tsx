"use client"

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
  formatCycleLabel,
  formatInvoiceDate,
  formatInvoiceNumber,
} from "@/lib/format"
import type { Id } from "@/convex/_generated/dataModel"
import type { InvoiceRow as InvoiceRowType } from "@/components/invoices/invoice-list"
import type { ReadyRow } from "@/lib/invoices/list-rows"
import { cn } from "@/lib/utils"

// ─── Invoice row ───────────────────────────────────────────────────────────

export function InvoiceRowItem({
  invoice,
  showProject,
  showStatus,
  timezone,
  selected,
  onSelect,
  onOpen,
}: {
  invoice: InvoiceRowType
  showProject: boolean
  showStatus: boolean
  timezone: string
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
          aria-label={`Select invoice ${formatInvoiceNumber(invoice.prefix, invoice.number)}`}
        />
      </TableCell>
      <TableCell className="font-medium">
        {formatInvoiceNumber(invoice.prefix, invoice.number)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {invoice.subject ?? "—"}
      </TableCell>
      {showProject && (
        <TableCell className="text-muted-foreground">
          {invoice.clientName}
        </TableCell>
      )}
      {showProject && (
        <TableCell className="text-muted-foreground">
          {invoice.projectName}
        </TableCell>
      )}
      <TableCell>
        <BillingTypeBadge type={invoice.projectBillingType as BillingType} />
      </TableCell>
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
      <TableCell className="text-muted-foreground">
        {invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "—"}
      </TableCell>
      <TableCell className="w-44 pl-0 text-right">
        <InvoiceRowActions
          invoiceId={invoice._id as Id<"invoices">}
          status={invoice.status}
        />
      </TableCell>
    </TableRow>
  )
}

// ─── Ready row ─────────────────────────────────────────────────────────────

/**
 * "Ready to be generated" row — same column grammar as `InvoiceRowItem` but
 * rendering pre-issuance state. Number and Due cells em-dash because those
 * values don't exist yet. The Status column carries the readiness pill
 * (within budget / over by Xh / blank for fixed+T&M) — the eye reads the
 * column position consistently with invoice rows below.
 */
export function ReadyRowItem({
  row,
  showProject,
  showStatus,
  selected,
  onSelect,
  onGenerate,
}: {
  row: ReadyRow
  showProject: boolean
  showStatus: boolean
  selected: boolean
  onSelect: (shiftKey: boolean) => void
  onGenerate: () => void
}) {
  return (
    <TableRow
      className={cn("group cursor-pointer", selected && "bg-muted/40")}
      data-selected={selected || undefined}
      onClick={onGenerate}
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
      <TableCell className="font-medium">{readySubject(row)}</TableCell>
      {showProject && (
        <TableCell className="text-muted-foreground">{row.clientName}</TableCell>
      )}
      {showProject && (
        <TableCell className="text-muted-foreground">{row.projectName}</TableCell>
      )}
      <TableCell>
        <BillingTypeBadge type={billingTypeForKind(row.kind) as BillingType} />
      </TableCell>
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
        {formatCurrency(row.amount, row.currency)}
      </TableCell>
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell
        className="w-44 pl-0 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <Button size="sm" onClick={onGenerate}>
          Generate
        </Button>
      </TableCell>
    </TableRow>
  )
}

function ReadinessBadge({ row }: { row: ReadyRow }) {
  // Fixed and T&M intentionally have no badge — the cell stays empty so the
  // column reads as a status slot, not a "needs filler" column.
  if (row.badgeKind === null) return null
  if (row.badgeKind === "within-budget") {
    return <ColoredPillBadge tone="green" label="within budget" />
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
      return "retainer"
    case "fixed":
      return "fixed"
    case "tm":
      return "t_and_m"
  }
}

function readySubject(row: ReadyRow): string {
  if (row.kind === "retainer-monthly" && row.period) {
    return monthLong(row.period)
  }
  if (row.kind === "retainer-cycle" && row.period) {
    return `${cycleLabelFor(row)} cycle`
  }
  if (row.kind === "tm" && row.period) {
    return monthLong(row.period)
  }
  return "Full milestone"
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
    year: "numeric",
  })
}

function cycleLabelFor(row: ReadyRow): string {
  if (!row.period) return ""
  const cycleLen = row.cycleLengthMonths
  if (!cycleLen || cycleLen < 1) return monthShort(row.period)
  return formatCycleLabel(
    buildCycleMonths(row.period.year, row.period.month, cycleLen),
  )
}
