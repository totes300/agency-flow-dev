"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { BillingStatusBadge } from "@/components/billing-status-badge"
import {
  formatCurrency,
  formatDateToUS,
  formatInvoiceNumber,
  formatMinutes,
} from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  ArrowUpRightIcon,
  BanIcon,
  DollarSignIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"

export type TimeEntryRow = {
  _id: Id<"timeEntries">
  taskId: Id<"tasks">
  taskTitle: string
  userId: Id<"users">
  userName: string
  userImageUrl: string | undefined
  date: string
  /** Wall-clock start in epoch ms — used by the edit modal to keep
   *  date/startedAt consistent when the user moves an entry to a new date. */
  startedAt: number
  durationMinutes: number
  note: string | undefined
  isBillable: boolean
  billableRate: number
  costRate: number
  workCategoryId: Id<"workCategories"> | undefined
  workCategoryName: string | undefined
  workCategoryColor: string | undefined
  invoiceId: Id<"invoices"> | undefined
  invoicePrefix: string | undefined
  invoiceNumber: number | undefined
  invoiceStatus: "draft" | "invoiced" | "paid" | "void" | undefined
  invoiceDueDate: string | undefined
  // Phase 8 — settlement snapshot. Used by selection-toolbar / stats /
  // edit-modal lock gating, and by Slice 4's tooltips / drill-down.
  settledAt: number | undefined
  settledReason:
    | "invoiced"
    | "retainer_included"
    | "fixed_included"
    | undefined
  settledPeriodStart: string | undefined
  settledPeriodEnd: string | undefined
}

/** T&M billable + uninvoiced entries are the only rows that can be selected. */
function isSelectable(row: TimeEntryRow, selectable: boolean): boolean {
  return selectable && row.isBillable && !row.invoiceId
}

export type ProjectTimeTableProps = {
  entries: TimeEntryRow[]
  selectedIds: Set<string>
  /** Receives the full row, not just the id, so the parent can stash the
   *  row data alongside the selection — lets the Time tab keep a row selected
   *  even after the current filter hides it. */
  onToggle: (row: TimeEntryRow) => void
  /**
   * Toggle every selectable row in `entries` (this table's own slice — in
   * grouped view that's one group). The parent owns the Set and folds these
   * rows in/out without touching rows from other groups.
   */
  onSelectAllVisible: (selectAll: boolean, rows: TimeEntryRow[]) => void
  /** True when checkboxes should render (admin + T&M). */
  selectable: boolean
  showAmounts: boolean
  currency: string
  timezone: string
  isAdmin: boolean
  currentUserId: Id<"users"> | undefined
  onEdit: (entryId: Id<"timeEntries">) => void
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
  isAdmin,
  currentUserId,
  onEdit,
}: ProjectTimeTableProps) {
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
                onCheckedChange={(checked) =>
                  onSelectAllVisible(checked === true, entries)
                }
                aria-label="Select all visible entries"
                disabled={selectableRows.length === 0}
              />
            </TableHead>
          )}
          <TableHead className="w-24">Date</TableHead>
          <TableHead className="w-40">Member</TableHead>
          <TableHead>Task</TableHead>
          <TableHead className="w-40">Category</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-20 text-right">Hours</TableHead>
          {showAmounts && <TableHead className="w-20 text-right">Rate</TableHead>}
          {showAmounts && <TableHead className="w-24 text-right">Amount</TableHead>}
          <TableHead className="w-10" aria-label="Row actions" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((row) => (
          <TimeEntryTableRow
            key={row._id}
            row={row}
            selected={selectedIds.has(row._id)}
            onToggle={onToggle}
            selectable={selectable}
            showAmounts={showAmounts}
            currency={currency}
            timezone={timezone}
            canEdit={isAdmin || row.userId === currentUserId}
            onEdit={onEdit}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function TimeEntryTableRow({
  row,
  selected,
  onToggle,
  selectable,
  showAmounts,
  currency,
  timezone,
  canEdit,
  onEdit,
}: {
  row: TimeEntryRow
  selected: boolean
  onToggle: (row: TimeEntryRow) => void
  selectable: boolean
  showAmounts: boolean
  currency: string
  timezone: string
  canEdit: boolean
  onEdit: (entryId: Id<"timeEntries">) => void
}) {
  const rowSelectable = isSelectable(row, selectable)
  const amount = (row.durationMinutes / 60) * row.billableRate
  const isInvoiced = !!row.invoiceId

  return (
    <TableRow
      className={cn(rowSelectable && "cursor-pointer")}
      data-selectable={rowSelectable || undefined}
      onClick={() => {
        if (rowSelectable) onToggle(row)
      }}
    >
      {selectable && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          {rowSelectable ? (
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggle(row)}
              aria-label={`Select entry on ${row.date}`}
            />
          ) : null}
        </TableCell>
      )}
      <TableCell className="text-muted-foreground tabular-nums">
        {formatDateToUS(row.date)}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <UserAvatar name={row.userName} imageUrl={row.userImageUrl} size="sm" />
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
      <TableCell onClick={(e) => e.stopPropagation()}>
        <BillingStatusCell row={row} timezone={timezone} />
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
        {canEdit && (
          <RowActionsMenu
            row={row}
            isInvoiced={isInvoiced}
            onEdit={() => onEdit(row._id)}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

function RowActionsMenu({
  row,
  isInvoiced,
  onEdit,
}: {
  row: TimeEntryRow
  isInvoiced: boolean
  onEdit: () => void
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  const removeEntry = useMutation(api.timeEntries.remove)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const toggleInFlightRef = useRef(false)

  async function runToggle(target: boolean): Promise<boolean> {
    try {
      await updateEntry({ id: row._id, isBillable: target })
      return true
    } catch (err) {
      toastError(err, "Couldn't update entry")
      return false
    }
  }

  async function handleToggleBillable() {
    if (isInvoiced || toggleInFlightRef.current) return
    toggleInFlightRef.current = true
    const target = !row.isBillable
    const current = row.isBillable
    const ok = await runToggle(target)
    toggleInFlightRef.current = false
    if (!ok) return
    toast(`Marked ${target ? "billable" : "non-billable"}`, {
      id: `billable-toggle-${row._id}`,
      action: {
        label: "Undo",
        onClick: () => {
          void runToggle(current)
        },
      },
    })
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await removeEntry({ id: row._id })
      toast.success("Entry deleted")
      setConfirmOpen(false)
    } catch (err) {
      toastError(err, "Failed to delete entry")
    } finally {
      setIsDeleting(false)
    }
  }

  // Invoiced rows are locked: rather than rendering a menu of greyed-out
  // items that require a tooltip to explain why, we show a single useful
  // action — "Open invoice INV-…" — which itself communicates the lock.
  // Uninvoiced rows get the full edit/toggle/delete menu.
  if (isInvoiced && row.invoicePrefix && row.invoiceNumber != null) {
    const invoiceNumber = formatInvoiceNumber(row.invoicePrefix, row.invoiceNumber)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Row actions"
            className="size-7 text-muted-foreground"
          >
            <MoreHorizontalIcon aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`/invoices/${invoiceNumber}`}>
              <ArrowUpRightIcon aria-hidden className="size-3.5" />
              Open invoice {invoiceNumber}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const toggleLabel = row.isBillable ? "Mark non-billable" : "Mark billable"
  const ToggleIcon = row.isBillable ? BanIcon : DollarSignIcon

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Row actions"
            className="size-7 text-muted-foreground"
          >
            <MoreHorizontalIcon aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon aria-hidden className="size-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              void handleToggleBillable()
            }}
          >
            <ToggleIcon aria-hidden className="size-3.5" />
            {toggleLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault()
              setConfirmOpen(true)
            }}
          >
            <Trash2Icon aria-hidden className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the time entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Status cell shows only the state chip. For invoiced rows the jump-to-invoice
 * lives in the row action menu as "Open invoice INV-…", keeping this cell
 * narrow and scannable.
 */
function BillingStatusCell({
  row,
  timezone,
}: {
  row: TimeEntryRow
  timezone: string
}) {
  if (!row.isBillable) return <BillingStatusBadge state="non_billable" />
  if (row.invoiceId && row.invoiceStatus) {
    return (
      <InvoiceStatusBadge
        status={row.invoiceStatus}
        dueDate={row.invoiceDueDate}
        timezone={timezone}
      />
    )
  }
  return <BillingStatusBadge state="uninvoiced" />
}
