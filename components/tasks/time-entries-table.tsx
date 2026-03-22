"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { UserAvatar } from "@/components/user-avatar"
import { formatShortDate, firstName } from "@/lib/format"
import { cn } from "@/lib/utils"
import { formatMinutesDisplay, formatDuration, parseDuration } from "@/lib/duration"
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
import { MoreHorizontalIcon, Trash2Icon, PencilIcon } from "lucide-react"
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
  const updateEntry = useMutation(api.timeEntries.update)
  const [deleteTarget, setDeleteTarget] = useState<Id<"timeEntries"> | null>(null)
  const [editingId, setEditingId] = useState<Id<"timeEntries"> | null>(null)
  const [editDuration, setEditDuration] = useState("")
  const [editNote, setEditNote] = useState("")
  const durationInputRef = useRef<HTMLInputElement>(null)

  function startEdit(entry: TimeEntry) {
    setEditingId(entry._id)
    setEditDuration(formatDuration(entry.durationMinutes))
    setEditNote(entry.note ?? "")
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDuration("")
    setEditNote("")
  }

  async function saveEdit() {
    if (!editingId) return
    const minutes = parseDuration(editDuration)
    if (!minutes) {
      toast.error("Enter a valid duration (e.g. 2h 30m, 90m)")
      return
    }
    try {
      await updateEntry({
        id: editingId,
        durationMinutes: minutes,
        note: editNote.trim() || null,
      })
      toast.success("Time entry updated")
      cancelEdit()
    } catch (err) {
      toastError(err, "Failed to update")
    }
  }

  // Focus duration input when entering edit mode
  useEffect(() => {
    if (editingId && durationInputRef.current) {
      durationInputRef.current.focus()
      durationInputRef.current.select()
    }
  }, [editingId])

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
          const isEditing = editingId === entry._id

          if (isEditing) {
            return (
              <div
                key={entry._id}
                className={`group/entry grid ${COL} items-center gap-x-2 px-3.5 h-[38px] border-b border-border/20 last:border-b-0 bg-muted/30`}
              >
                {/* Date (read-only in edit mode) */}
                <span className="text-[13px] text-foreground">{formatShortDate(entry.date)}</span>

                {/* Person (read-only) */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <UserAvatar
                    name={entry.userName}
                    imageUrl={entry.userImageUrl}
                    className="size-5 text-[8px]"
                  />
                  <span className="text-[13px] text-foreground truncate">{firstName(entry.userName)}</span>
                </div>

                {/* Note (editable) */}
                <input
                  aria-label="Edit note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit()
                    if (e.key === "Escape") cancelEdit()
                  }}
                  placeholder="Add a note"
                  className="h-6 rounded border border-border/60 bg-background px-1.5 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                />

                {/* Duration (editable) */}
                <input
                  ref={durationInputRef}
                  aria-label="Edit duration"
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit()
                    if (e.key === "Escape") cancelEdit()
                  }}
                  onBlur={saveEdit}
                  className="h-6 w-full rounded border border-border/60 bg-background px-1.5 text-[13px] font-mono font-medium text-foreground text-right outline-none focus:ring-1 focus:ring-ring"
                />

                {/* Billable dot */}
                <div className="flex items-center justify-center">
                  <div
                    className={cn("size-1.5 rounded-full", entry.isBillable ? "bg-emerald-500" : "bg-border")}
                    title={entry.isBillable ? "Billable" : "Non-billable"}
                  />
                </div>

                {/* Cancel hint */}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    aria-label="Cancel editing"
                    onClick={cancelEdit}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted text-xs"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          }

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
                <span className="text-[13px] text-foreground truncate">{firstName(entry.userName)}</span>
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
                      <DropdownMenuItem onClick={() => startEdit(entry)}>
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
