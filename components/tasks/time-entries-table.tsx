"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { UserAvatar } from "@/components/user-avatar"
import { CategoryBadge } from "@/components/category-badge"
import { formatShortDate, firstName } from "@/lib/format"
import { cn } from "@/lib/utils"
import { formatMinutesDisplay } from "@/lib/duration"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  LockIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  PencilIcon,
} from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { formatLockedTooltip } from "@/lib/entry-tooltip"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import type { EntryCloseSnapshot } from "@/convex/lib/types"

// Phase 8 Slice 4 — task-detail Time tab inherits the row-level lock
// treatment from the project Time tab. The shape is wider than the
// minimum: settlement + invoice fields are optional so any callers
// still wiring through the older shape keep working with unlocked
// rendering.
export type TimeEntry = {
  _id: Id<"timeEntries">
  taskId: Id<"tasks">
  userId: Id<"users">
  date: string
  // Wall-clock start (epoch ms) — the edit modal re-anchors it on date change.
  startedAt: number
  durationMinutes: number
  note?: string
  isBillable: boolean
  userName: string
  userImageUrl?: string
  // Entry billing category (sticky). Shown as a column and edited via the modal.
  snapshotCategoryId?: Id<"workCategories">
  invoiceId?: Id<"invoices">
  invoicePrefix?: string
  invoiceNumber?: number
} & EntryCloseSnapshot

// Date | Person | Note | Category | Time | lock/dot | menu
const COL = "grid-cols-[70px_110px_1fr_120px_60px_18px_28px]"

export function TimeEntriesTable({
  entries,
  isAdmin,
  currentUserId,
  categories,
  onEditEntry,
}: {
  entries: TimeEntry[]
  isAdmin: boolean
  currentUserId?: Id<"users">
  categories?: Doc<"workCategories">[]
  /** Open the shared full edit modal for this entry (project-tab parity). */
  onEditEntry: (entry: TimeEntry) => void
}) {
  const removeEntry = useMutation(api.timeEntries.remove)
  const [deleteTarget, setDeleteTarget] = useState<Id<"timeEntries"> | null>(null)

  const categoryMap = new Map(
    (categories ?? []).map((c) => [c._id.toString(), c]),
  )

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await removeEntry({ id: deleteTarget })
      toast.success("Time entry deleted")
    } catch (err) {
      toastError(err, "Failed to delete")
    } finally {
      setDeleteTarget(null)
    }
  }

  if (entries.length === 0) return null

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border/40">
        {/* Header */}
        <div className={`grid ${COL} items-center gap-x-2 px-3.5 py-1.5 bg-muted/30 border-b border-border/40`}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Person</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Note</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Time</span>
          <span />
          <span />
        </div>

        {/* Rows */}
        {entries.map((entry) => {
          // Close-locked rows (billable or not) are not editable — the
          // server's close guard would reject the patch anyway. Mirroring it
          // keeps the menu from offering Edit/Delete that would error.
          const isLocked = entry.closeStatus !== undefined
          const canEdit =
            !isLocked &&
            (isAdmin || (currentUserId && entry.userId === currentUserId))
          const category = entry.snapshotCategoryId
            ? categoryMap.get(entry.snapshotCategoryId.toString())
            : undefined
          const lockedTooltip = isLocked
            ? formatLockedTooltip({
                closeStatus: entry.closeStatus,
                closeKind: entry.closeKind,
                closePeriodStart: entry.closePeriodStart,
                closePeriodEnd: entry.closePeriodEnd,
                closedAt: entry.closedAt,
                invoicePrefix: entry.invoicePrefix,
                invoiceNumber: entry.invoiceNumber,
              })
            : null

          return (
            <div
              key={entry._id}
              data-locked={isLocked || undefined}
              className={cn(
                `group/entry grid ${COL} items-center gap-x-2 px-3.5 h-[38px] border-b border-border/20 last:border-b-0 hover:bg-muted/20 transition-colors`,
                // Mirrors the project Time tab's locked treatment so a
                // row reads identically across surfaces.
                isLocked && "opacity-[0.72]",
              )}
            >
              {/* Date */}
              <span className="text-[13px] text-foreground">{formatShortDate(entry.date)}</span>

              {/* Person */}
              <div className="flex items-center gap-1.5 min-w-0">
                <UserAvatar
                  name={entry.userName}
                  imageUrl={entry.userImageUrl}
                  className="size-5 text-[8px]"
                />
                <span className="text-[13px] text-foreground truncate">{firstName(entry.userName)}</span>
              </div>

              {/* Note */}
              <span className="text-[13px] text-muted-foreground truncate">
                {entry.note || "—"}
              </span>

              {/* Category */}
              <div className="min-w-0">
                {category ? (
                  <CategoryBadge name={category.name} color={category.color} />
                ) : (
                  <span className="text-[13px] text-muted-foreground/50">—</span>
                )}
              </div>

              {/* Duration */}
              <span className="text-[13px] font-mono font-medium text-foreground text-right">
                {formatMinutesDisplay(entry.durationMinutes)}
              </span>

              {/* Lock or billable dot — `🔒` wins when the row is
                  locked (overrides the dot, since a locked entry's
                  billability is no longer actionable from this row). */}
              <div className="flex items-center justify-center">
                {isLocked ? (
                  lockedTooltip ? (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <LockIcon
                            className="size-3 text-muted-foreground"
                            aria-label="Locked"
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {lockedTooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <LockIcon
                      className="size-3 text-muted-foreground"
                      aria-label="Locked"
                    />
                  )
                ) : (
                  <div
                    className={cn(
                      "size-1.5 rounded-full",
                      entry.isBillable ? "bg-green-500" : "bg-border",
                    )}
                    title={entry.isBillable ? "Billable" : "Non-billable"}
                  />
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-center">
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Time entry actions"
                        className="flex size-6 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity group-hover/entry:opacity-100 focus-visible:opacity-100 hover:!text-foreground hover:bg-muted"
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem onClick={() => onEditEntry(entry)}>
                        <PencilIcon className="size-3.5" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(entry._id)}
                      >
                        <Trash2Icon className="size-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
