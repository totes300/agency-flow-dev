"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { formatDuration } from "@/lib/duration"
import { formatShortDate, getInitials } from "@/lib/format"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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

export function TimeEntriesList({
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

  if (entries.length === 0) return null

  async function handleDeleteConfirmed() {
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

  return (
    <>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => {
          const canEdit = isAdmin || (currentUserId && entry.userId === currentUserId)
          const initials = getInitials(entry.userName)

          return (
            <div key={entry._id} className="flex items-start gap-2">
              {/* Avatar */}
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <span className="text-[9px] font-semibold text-muted-foreground">{initials}</span>
              </div>
              {/* Content */}
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">
                    {formatShortDate(entry.date)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {entry.isBillable && (
                      <span
                        className="size-1.5 rounded-full bg-green-500"
                        title="Billable"
                        aria-label="Billable"
                      />
                    )}
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatDuration(entry.durationMinutes)}
                    </span>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="ml-0.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
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
                    )}
                  </div>
                </div>
                {entry.note && (
                  <span className="text-[11px] text-muted-foreground">{entry.note}</span>
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
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteConfirmed}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
