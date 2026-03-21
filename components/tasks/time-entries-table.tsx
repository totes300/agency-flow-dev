"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { UserAvatar } from "@/components/user-avatar"
import { formatShortDate } from "@/lib/format"
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
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

type TimeEntry = {
  _id: Id<"timeEntries">
  userId: Id<"users">
  date: string
  durationMinutes: number
  note?: string
  isBillable: boolean
  userName: string
  userImageUrl?: string
}

const COL = "grid-cols-[70px_120px_1fr_60px_18px_28px]"

export function TimeEntriesTable({
  entries,
  isAdmin,
  currentUserId,
}: {
  entries: TimeEntry[]
  isAdmin: boolean
  currentUserId?: Id<"users">
}) {
  const removeEntry = useMutation(api.timeEntries.remove)
  const [deleteTarget, setDeleteTarget] = useState<Id<"timeEntries"> | null>(null)

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
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Time</span>
          <span />
          <span />
        </div>

        {/* Rows */}
        {entries.map((entry) => {
          const canEdit = isAdmin || (currentUserId && entry.userId === currentUserId)

          return (
            <div
              key={entry._id}
              className={`group/entry grid ${COL} items-center gap-x-2 px-3.5 h-[38px] border-b border-border/20 last:border-b-0 hover:bg-muted/20 transition-colors`}
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
                <span className="text-[13px] text-foreground truncate">{entry.userName.split(" ")[0]}</span>
              </div>

              {/* Note */}
              <span className="text-[13px] text-muted-foreground truncate">
                {entry.note || "—"}
              </span>

              {/* Duration */}
              <span className="text-[13px] font-mono font-medium text-foreground text-right">
                {formatMinutesDisplay(entry.durationMinutes)}
              </span>

              {/* Billable dot */}
              <div className="flex items-center justify-center">
                <div
                  className={`size-1.5 rounded-full ${entry.isBillable ? "bg-green-500" : "bg-border"}`}
                  title={entry.isBillable ? "Billable" : "Non-billable"}
                />
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
