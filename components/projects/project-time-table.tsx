"use client"

import Link from "next/link"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { BillingStatusBadge } from "@/components/billing-status-badge"
import { formatCurrency, formatMinutes, formatInvoiceNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export type TimeEntryRow = {
  _id: Id<"timeEntries">
  taskId: Id<"tasks">
  taskTitle: string
  userId: Id<"users">
  userName: string
  userImageUrl: string | undefined
  date: string
  durationMinutes: number
  note: string | undefined
  isBillable: boolean
  billableRate: number
  workCategoryId: Id<"workCategories"> | undefined
  workCategoryName: string | undefined
  workCategoryColor: string | undefined
  invoiceId: Id<"invoices"> | undefined
  invoicePrefix: string | undefined
  invoiceNumber: number | undefined
  invoiceStatus: "draft" | "invoiced" | "paid" | undefined
  invoiceDueDate: string | undefined
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-")
  return `${month}/${day}/${year}`
}

/** T&M billable + uninvoiced entries are the only rows that can be selected. */
function isSelectable(row: TimeEntryRow, selectable: boolean): boolean {
  return selectable && row.isBillable && !row.invoiceId
}

export function ProjectTimeTable({
  entries,
  selectedIds,
  onToggle,
  onSelectAllVisible,
  selectable,
  showAmounts,
  currency,
  timezone,
}: {
  entries: TimeEntryRow[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onSelectAllVisible: (selectAll: boolean) => void
  selectable: boolean
  showAmounts: boolean
  currency: string
  timezone: string
}) {
  const selectableRows = entries.filter((r) => isSelectable(r, selectable))
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r._id))
  const someSelected =
    selectableRows.some((r) => selectedIds.has(r._id)) && !allSelected

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(checked) => onSelectAllVisible(checked === true)}
                aria-label="Select all visible entries"
                disabled={selectableRows.length === 0}
              />
            </TableHead>
          )}
          <TableHead className="w-24">Date</TableHead>
          <TableHead className="w-40">Member</TableHead>
          <TableHead>Task</TableHead>
          <TableHead className="w-40">Category</TableHead>
          <TableHead className="w-20 text-right">Hours</TableHead>
          {showAmounts && <TableHead className="w-20 text-right">Rate</TableHead>}
          {showAmounts && <TableHead className="w-24 text-right">Amount</TableHead>}
          <TableHead className="w-32">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((row) => {
          const rowSelectable = isSelectable(row, selectable)
          const checked = selectedIds.has(row._id)
          const amount = (row.durationMinutes / 60) * row.billableRate

          return (
            // Row click is a mouse-only convenience hit target — keyboard
            // users toggle via the checkbox inside, which carries the accessible
            // name and focusable role. Adding tabIndex/role here would create a
            // competing tab stop next to the checkbox (bad for screen readers).
            <TableRow
              key={row._id}
              className={cn(rowSelectable && "cursor-pointer")}
              data-selectable={rowSelectable || undefined}
              onClick={() => {
                if (rowSelectable) onToggle(row._id)
              }}
            >
              {selectable && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {rowSelectable ? (
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(row._id)}
                      aria-label={`Select entry on ${row.date}`}
                    />
                  ) : null}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground tabular-nums">
                {formatDate(row.date)}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <UserAvatar
                    name={row.userName}
                    imageUrl={row.userImageUrl}
                    size="sm"
                  />
                  <span className="truncate text-sm">{row.userName}</span>
                </span>
              </TableCell>
              <TableCell>
                <span className="truncate text-sm font-medium">{row.taskTitle}</span>
                {row.note && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.note}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {row.workCategoryName && row.workCategoryColor ? (
                  <CategoryBadge
                    name={row.workCategoryName}
                    color={row.workCategoryColor}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMinutes(row.durationMinutes)}
              </TableCell>
              {showAmounts && (
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.isBillable ? formatCurrency(row.billableRate, currency) : "—"}
                </TableCell>
              )}
              {showAmounts && (
                <TableCell className="text-right tabular-nums">
                  {row.isBillable ? formatCurrency(amount, currency) : "—"}
                </TableCell>
              )}
              <TableCell onClick={(e) => e.stopPropagation()}>
                <BillingStatusCell row={row} timezone={timezone} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function BillingStatusCell({
  row,
  timezone,
}: {
  row: TimeEntryRow
  timezone: string
}) {
  if (!row.isBillable) return <BillingStatusBadge state="non_billable" />

  if (row.invoiceId && row.invoiceStatus && row.invoicePrefix && row.invoiceNumber != null) {
    return (
      <Link
        href={`/invoices/${row.invoiceId}`}
        className="inline-flex items-center gap-1.5 hover:opacity-80"
      >
        <InvoiceStatusBadge
          status={row.invoiceStatus}
          dueDate={row.invoiceDueDate}
          timezone={timezone}
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatInvoiceNumber(row.invoicePrefix, row.invoiceNumber)}
        </span>
      </Link>
    )
  }

  return <BillingStatusBadge state="uninvoiced" />
}
