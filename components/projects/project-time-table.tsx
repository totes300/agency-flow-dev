"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { CarriedReason } from "@/convex/lib/billingScope"
import type { EntrySettlementSnapshot } from "@/convex/lib/types"
import { entryStatus } from "@/convex/lib/entryStatus"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CarriedLabel } from "@/components/carried-label"
import { CategoryBadge } from "@/components/category-badge"
import { InlineEditable } from "@/components/inline-editable"
import { TaskTitleButton } from "@/components/task-title-button"
import { TimeEntryHoursCell } from "@/components/projects/time-entry-hours-cell"
import { UserAvatar } from "@/components/user-avatar"
import { BillingStatusBadge } from "@/components/billing-status-badge"
import { ReopenPeriodDialog } from "@/components/projects/reopen-period-dialog"
import { formatLockedTooltip } from "@/lib/entry-tooltip"
import {
  formatCurrency,
  formatDateToUS,
  formatInvoiceNumber,
} from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  ArrowUpRightIcon,
  BanIcon,
  CornerUpRightIcon,
  DollarSignIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"

// Settlement fields come from the shared `EntrySettlementSnapshot` so the
// schema, the Convex Row type, and this component-side row stay in
// lock-step. Adding a settlement field means editing `lib/types.ts` only.
//
// `ProjectTimeTableRow` is the table's OWN structural contract — only fields
// the table actually renders or derives from. Callers with richer rows
// (`TimeEntryRow`, `CloseWorkspaceRow`) satisfy it without fabricating data.
export type ProjectTimeTableRow = EntrySettlementSnapshot & {
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
  workCategoryId: Id<"workCategories"> | undefined
  workCategoryName: string | undefined
  workCategoryColor: string | undefined
  invoiceId: Id<"invoices"> | undefined
  invoicePrefix: string | undefined
  invoiceNumber: number | undefined
  invoiceStatus: "draft" | "invoiced" | "paid" | "void" | undefined
  invoiceDueDate: string | undefined
  // ── Close-workspace extras (present only on close-ledger rows) ──────────
  /** Server-computed billable amount. When present the Amount cell renders
   *  THIS instead of rate × duration — the close ledger must agree with the
   *  server's commit totals to the cent (rounding happens server-side). */
  amount?: number | null
  carried?: boolean
  carriedReason?: CarriedReason
  originMonthLabel?: string
  /** Entry skipped OUT of the close period — renders as a muted undo row. */
  skipped?: boolean
  skippedToLabel?: string | null
}

/** Project Time tab row — the table contract plus Time-tab-only fields. */
export type TimeEntryRow = ProjectTimeTableRow & {
  costRate: number
}

/**
 * Close-workspace behavior bundle. One cohesive object (never loose flags):
 * when present, rows gain skip/unskip actions (hover shortcut + ⋯ menu item),
 * skipped-row rendering, the carried label, review-warning markers, and
 * optional inline note editing. Mutually exclusive with `selectable` — the
 * close ledger has no row selection.
 */
export type CloseTableConfig = {
  /** Label of the next open period ("July 2026") — null hides skip actions. */
  nextPeriodLabel: string | null
  onSkip: (entryIds: Id<"timeEntries">[], nextLabel: string) => void
  onUnskip: (entryIds: Id<"timeEntries">[]) => void
  /** entryId → reason text; flagged rows show an amber dot next to the note. */
  rowWarnings?: Map<string, string>
  /** Edit notes in place (InlineEditable) instead of static note text. */
  inlineNoteEdit: boolean
  /** Suppress per-row carried labels (the group header carries a promoted one). */
  hideCarriedLabels?: boolean
}

/** T&M billable + uninvoiced entries are the only rows that can be selected. */
function isSelectable(row: ProjectTimeTableRow, selectable: boolean): boolean {
  return selectable && row.isBillable && !row.invoiceId
}

export type ProjectTimeTableProps<
  T extends ProjectTimeTableRow = ProjectTimeTableRow,
> = {
  entries: T[]
  selectedIds: Set<string>
  /** Receives the full row, not just the id, so the parent can stash the
   *  row data alongside the selection — lets the Time tab keep a row selected
   *  even after the current filter hides it. */
  onToggle: (row: T) => void
  /**
   * Toggle every selectable row in `entries` (this table's own slice — in
   * grouped view that's one group). The parent owns the Set and folds these
   * rows in/out without touching rows from other groups.
   */
  onSelectAllVisible: (selectAll: boolean, rows: T[]) => void
  /** True when checkboxes should render (admin + T&M). */
  selectable: boolean
  showAmounts: boolean
  currency: string
  timezone: string
  isAdmin: boolean
  /** Used by the reopen-period dialog on Closed retainer rows. */
  projectId: Id<"projects">
  currentUserId: Id<"users"> | undefined
  onEdit: (entryId: Id<"timeEntries">) => void
  /** Opens the task detail (?detail=taskId drawer/modal) for the row's task. */
  onOpenTask: (taskId: Id<"tasks">) => void
  /** Task currently open in the detail view — its rows get a subtle highlight. */
  activeTaskId?: string | null
  /** Hide the Status column (close ledger: every in-scope row is "open"). */
  statusColumn?: boolean
  /** Close-workspace behavior bundle — see `CloseTableConfig`. */
  closeMode?: CloseTableConfig
}

export function ProjectTimeTable<T extends ProjectTimeTableRow>({
  entries,
  selectedIds,
  onToggle,
  onSelectAllVisible,
  selectable,
  showAmounts,
  currency,
  // `timezone` is part of the shared prop bag for the table's callers
  // but Slice 4 dropped the only consumer (the InvoiceStatusBadge that
  // computed Overdue against today). Kept on the props type so the
  // grouped + flat call sites can spread `sharedTableProps` without
  // having to fork.
  isAdmin,
  projectId,
  currentUserId,
  onEdit,
  onOpenTask,
  activeTaskId,
  statusColumn = true,
  closeMode,
}: ProjectTimeTableProps<T>) {
  if (process.env.NODE_ENV !== "production" && closeMode && selectable) {
    throw new Error(
      "ProjectTimeTable: `closeMode` and `selectable` are mutually exclusive — the close ledger has no row selection.",
    )
  }

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
          {statusColumn && <TableHead className="w-32">Status</TableHead>}
          <TableHead className="w-20 text-right">Hours</TableHead>
          {showAmounts && <TableHead className="w-20 text-right">Rate</TableHead>}
          {showAmounts && <TableHead className="w-24 text-right">Amount</TableHead>}
          <TableHead
            className={closeMode ? "w-16" : "w-10"}
            aria-label="Row actions"
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((row) =>
          closeMode && row.skipped ? (
            <SkippedEntryRow
              key={row._id}
              row={row}
              closeMode={closeMode}
              showAmounts={showAmounts}
              statusColumn={statusColumn}
            />
          ) : (
            <TimeEntryTableRow
              key={row._id}
              row={row}
              selected={selectedIds.has(row._id)}
              onToggle={onToggle}
              selectable={selectable}
              showAmounts={showAmounts}
              currency={currency}
              canEdit={isAdmin || row.userId === currentUserId}
              isAdmin={isAdmin}
              projectId={projectId}
              onEdit={onEdit}
              onOpenTask={onOpenTask}
              isActive={activeTaskId != null && row.taskId === activeTaskId}
              statusColumn={statusColumn}
              closeMode={closeMode}
            />
          ),
        )}
      </TableBody>
    </Table>
  )
}

/**
 * Skipped-out entry inside the close ledger — deferred to a later period.
 * Renders muted with an inline Undo; column layout mirrors the live rows so
 * the table grid never shifts. Only reachable when `closeMode` is set.
 */
function SkippedEntryRow({
  row,
  closeMode,
  showAmounts,
  statusColumn,
}: {
  row: ProjectTimeTableRow
  closeMode: CloseTableConfig
  showAmounts: boolean
  statusColumn: boolean
}) {
  return (
    <TableRow data-skipped className="text-muted-foreground">
      <TableCell className="tabular-nums">{formatDateToUS(row.date)}</TableCell>
      <TableCell>
        <span className="flex items-center gap-2 opacity-60">
          <UserAvatar name={row.userName} imageUrl={row.userImageUrl} size="sm" />
          <span className="truncate text-sm">{row.userName}</span>
        </span>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm">{row.taskTitle}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs">
            <CornerUpRightIcon aria-hidden className="size-3.5" />
            skipped → {row.skippedToLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-primary"
            onClick={() => closeMode.onUnskip([row._id])}
          >
            Undo
          </Button>
        </div>
        {row.note && (
          <span className="block truncate text-xs italic">{row.note}</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-xs">—</span>
      </TableCell>
      {statusColumn && <TableCell />}
      <TableCell className="text-right tabular-nums line-through">
        <TimeEntryHoursCell
          entryId={row._id}
          durationMinutes={row.durationMinutes}
          editable={false}
        />
      </TableCell>
      {showAmounts && <TableCell />}
      {showAmounts && <TableCell />}
      <TableCell />
    </TableRow>
  )
}

function TimeEntryTableRow<T extends ProjectTimeTableRow>({
  row,
  selected,
  onToggle,
  selectable,
  showAmounts,
  currency,
  canEdit,
  isAdmin,
  projectId,
  onEdit,
  onOpenTask,
  isActive,
  statusColumn,
  closeMode,
}: {
  row: T
  selected: boolean
  onToggle: (row: T) => void
  selectable: boolean
  showAmounts: boolean
  currency: string
  canEdit: boolean
  isAdmin: boolean
  projectId: Id<"projects">
  onEdit: (entryId: Id<"timeEntries">) => void
  onOpenTask: (taskId: Id<"tasks">) => void
  isActive: boolean
  statusColumn: boolean
  closeMode: CloseTableConfig | undefined
}) {
  const rowSelectable = isSelectable(row, selectable)
  // Close rows carry the server-computed amount (rounding parity with commit);
  // Time-tab rows compute display-only amounts from the rate.
  const amount = row.amount ?? (row.durationMinutes / 60) * row.billableRate
  // Phase 8 Slice 4 — row state via `entryStatus()` (single source of
  // truth, same derivation `listProjectEntries` filters on). Locked
  // rows (Draft + Closed) get a unified visual treatment — 72% opacity
  // + 🔒 marker on the badge — so the eye can skip them when scanning
  // for actionable work.
  const status = entryStatus(row)
  const isLocked = status === "draft" || status === "closed"

  return (
    <TableRow
      className={cn(
        "group/row",
        rowSelectable && "cursor-pointer",
        // 72% opacity per parent PRD § UI Changes → Time entry list.
        // The dropdown menu portal stays at full opacity so the action
        // menu remains readable when the user reaches for it.
        isLocked && "opacity-[0.72]",
        // Rows of the task currently open in the detail view stay marked so
        // the eye keeps its anchor while editing in the side peek.
        isActive && "bg-muted/50",
      )}
      data-selectable={rowSelectable || undefined}
      data-locked={isLocked || undefined}
      data-active={isActive || undefined}
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
        {closeMode ? (
          <div className="flex min-w-0 flex-col">
            <TaskTitleButton
              title={row.taskTitle}
              onClick={() => onOpenTask(row.taskId)}
            />
            <div className="flex min-w-0 items-center gap-2">
              {/* Review-warning marker — spot flagged rows while scrolling;
                  the reason lives in the tooltip. */}
              {closeMode.rowWarnings?.has(row._id) && (
                <span
                  title={closeMode.rowWarnings.get(row._id)}
                  className="size-1.5 shrink-0 rounded-full bg-amber-500/80"
                >
                  <span className="sr-only">
                    {closeMode.rowWarnings.get(row._id)}
                  </span>
                </span>
              )}
              {closeMode.inlineNoteEdit && canEdit && !isLocked ? (
                <InlineNoteCell entryId={row._id} note={row.note} />
              ) : (
                row.note && (
                  <span className="truncate text-xs text-muted-foreground">
                    {row.note}
                  </span>
                )
              )}
              {row.carried &&
                row.carriedReason &&
                row.originMonthLabel &&
                !closeMode.hideCarriedLabels && (
                  <CarriedLabel
                    reason={row.carriedReason}
                    monthLabel={row.originMonthLabel}
                  />
                )}
            </div>
          </div>
        ) : (
          <TaskTitleButton
            title={row.taskTitle}
            note={row.note}
            onClick={() => onOpenTask(row.taskId)}
          />
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
      {statusColumn && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <BillingStatusCell row={row} status={status} />
        </TableCell>
      )}
      {/* stopPropagation only when the cell is interactive — on locked /
          read-only rows a click should still toggle row selection. */}
      <TableCell
        className="text-right tabular-nums"
        onClick={canEdit && !isLocked ? (e) => e.stopPropagation() : undefined}
      >
        <TimeEntryHoursCell
          entryId={row._id}
          durationMinutes={row.durationMinutes}
          editable={canEdit && !isLocked}
        />
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
        <div className="flex items-center justify-end gap-0.5">
          {/* Skip is the close's signature action — hover shortcut on the row
              in addition to the ⋯ menu item, so triaging many rows doesn't
              cost a menu hop each. */}
          {closeMode?.nextPeriodLabel && canEdit && !isLocked && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
              aria-label={`Skip to ${closeMode.nextPeriodLabel}`}
              title={`Skip → ${closeMode.nextPeriodLabel}`}
              onClick={() =>
                closeMode.onSkip([row._id], closeMode.nextPeriodLabel!)
              }
            >
              <CornerUpRightIcon aria-hidden className="size-4" />
            </Button>
          )}
          {canEdit && (
            <RowActionsMenu
              row={row}
              status={status}
              isAdmin={isAdmin}
              projectId={projectId}
              onEdit={() => onEdit(row._id)}
              onOpenTask={() => onOpenTask(row.taskId)}
              skipAction={
                closeMode?.nextPeriodLabel && !isLocked
                  ? {
                      label: `Skip → ${closeMode.nextPeriodLabel}`,
                      onSelect: () =>
                        closeMode.onSkip([row._id], closeMode.nextPeriodLabel!),
                    }
                  : undefined
              }
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Inline note editor for close-ledger rows — the "missing note" checklist
 * flow is jump → type → done, so notes must be fixable without the modal.
 * Same mutation the modal uses; the reactive workspace query refreshes flags
 * and totals on save.
 */
function InlineNoteCell({
  entryId,
  note,
}: {
  entryId: Id<"timeEntries">
  note: string | undefined
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  return (
    <InlineEditable
      value={note ?? ""}
      onSave={async (next) => {
        await updateEntry({ id: entryId, note: next.length ? next : null })
      }}
      ariaLabel="Edit note"
      placeholder="Add a note"
      errorMessage="Couldn't update note"
      className="min-w-0 flex-1 text-xs text-muted-foreground"
    />
  )
}

function RowActionsMenu({
  row,
  status,
  isAdmin,
  projectId,
  onEdit,
  onOpenTask,
  skipAction,
}: {
  row: ProjectTimeTableRow
  status: "open" | "draft" | "closed" | "non_billable"
  isAdmin: boolean
  projectId: Id<"projects">
  onEdit: () => void
  onOpenTask: () => void
  /** Close-mode "Skip → <next period>" item — omitted outside the close. */
  skipAction?: { label: string; onSelect: () => void }
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  const removeEntry = useMutation(api.timeEntries.remove)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false)
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
    if (status === "draft" || status === "closed" || toggleInFlightRef.current) {
      return
    }
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

  // Locked rows (Draft + Closed) get a slim "view-only" menu per parent
  // PRD § UI Changes → Time entry list. Edit/Delete would error at the
  // server's settlement guard anyway, so we hide them and surface the
  // useful action instead.
  //
  // Three locked-row shapes:
  //   - Draft (on a draft invoice)           → `Open invoice INV-…`
  //   - Closed by an invoice (any reason)    → `Open invoice INV-…`
  //   - Closed by retainer-period close      → `View report` + admin Reopen
  if (status === "draft" || status === "closed") {
    const hasInvoiceLink =
      row.invoicePrefix && row.invoiceNumber != null && row.invoiceId
    const invoiceNumber =
      hasInvoiceLink && row.invoicePrefix && row.invoiceNumber != null
        ? formatInvoiceNumber(row.invoicePrefix, row.invoiceNumber)
        : null
    // Retainer period close populates `settledPeriodStart/End` AND the
    // period boundary is monthly (YYYY-MM-01 .. last-of-month). Used both
    // to build the View report link and to wire the Reopen dialog.
    const reopenable =
      status === "closed" &&
      row.settledReason === "retainer_included" &&
      row.settledPeriodStart !== undefined &&
      row.settledPeriodEnd !== undefined
    const reportPeriodToken = row.settledPeriodStart?.slice(0, 7)

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
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onOpenTask}>
              <PanelRightOpenIcon aria-hidden className="size-3.5" />
              Open task
            </DropdownMenuItem>
            {invoiceNumber && (
              <DropdownMenuItem asChild>
                <Link href={`/invoices/${invoiceNumber}`}>
                  <ArrowUpRightIcon aria-hidden className="size-3.5" />
                  Open invoice {invoiceNumber}
                </Link>
              </DropdownMenuItem>
            )}
            {reopenable && reportPeriodToken && (
              <DropdownMenuItem asChild>
                <Link
                  href={`/projects/${projectId}/reports/${reportPeriodToken}`}
                  target="_blank"
                  rel="noopener"
                >
                  <DownloadIcon aria-hidden className="size-3.5" />
                  View report
                </Link>
              </DropdownMenuItem>
            )}
            {reopenable && isAdmin && (
              <DropdownMenuItem onSelect={() => setReopenDialogOpen(true)}>
                <RotateCcwIcon aria-hidden className="size-3.5" />
                Reopen period
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {reopenable && row.settledPeriodStart && (
          <ReopenPeriodDialog
            open={reopenDialogOpen}
            onOpenChange={setReopenDialogOpen}
            projectId={projectId}
            periodStart={row.settledPeriodStart}
            periodLabel={formatPeriodMonth(row.settledPeriodStart)}
            workedMinutes={row.durationMinutes}
          />
        )}
      </>
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
        {/* Entry actions first (Edit is the menu's primary — this menu sits
            on a time entry), navigation after, destructive last. */}
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
          {skipAction && (
            <DropdownMenuItem onSelect={skipAction.onSelect}>
              <CornerUpRightIcon aria-hidden className="size-3.5" />
              {skipAction.label}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onOpenTask}>
            <PanelRightOpenIcon aria-hidden className="size-3.5" />
            Open task
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
 * Status cell — one chip per row, derived from `entryStatus()`. The
 * financial reason (retainer-included vs invoiced vs fixed-included)
 * lives in the period drill-down (Slice 4), never on the row. The
 * invoice's own state (Draft → Invoiced → Paid → Void) lives on the
 * Invoices tab and on day-group headers; for closed-by-invoice rows the
 * invoice number itself surfaces in the `⋯` menu's `Open invoice INV-…`
 * link. Wraps the chip in a tooltip when the row is locked so admins
 * can see WHEN/HOW it was settled without leaving the table.
 */
function BillingStatusCell({
  row,
  status,
}: {
  row: ProjectTimeTableRow
  status: "open" | "draft" | "closed" | "non_billable"
}) {
  const tooltip =
    status === "draft" || status === "closed"
      ? formatLockedTooltip({
          settledAt: row.settledAt,
          settledReason: row.settledReason,
          settledPeriodStart: row.settledPeriodStart,
          settledPeriodEnd: row.settledPeriodEnd,
          invoicePrefix: row.invoicePrefix,
          invoiceNumber: row.invoiceNumber,
        })
      : null

  const badge = <BillingStatusBadge state={status} />
  if (!tooltip) return badge
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * YYYY-MM-01 → "March 2026". Used by the reopen dialog on locked rows so
 * the consequence message names the period in human terms.
 */
function formatPeriodMonth(periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}
