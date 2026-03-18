"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { formatDuration } from "@/lib/duration"
import { formatShortDate } from "@/lib/format"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
  currentUserId: Id<"users">
}) {
  const removeEntry = useMutation(api.timeEntries.remove)

  if (entries.length === 0) return null

  async function handleDelete(id: Id<"timeEntries">) {
    try {
      await removeEntry({ id })
      toast.success("Time entry deleted")
    } catch (err) {
      toastError(err, "Failed to delete")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        const canEdit = isAdmin || entry.userId === currentUserId
        const initials = entry.userName
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 2)

        return (
          <div key={entry._id} className="flex items-start gap-2">
            {/* Avatar */}
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100">
              <span className="text-[9px] font-semibold text-blue-500">{initials}</span>
            </div>
            {/* Content */}
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-stone-600">
                  {formatShortDate(entry.date)}
                </span>
                <div className="flex items-center gap-1.5">
                  {entry.isBillable && (
                    <span className="size-1.5 rounded-full bg-green-500" />
                  )}
                  <span
                    className="font-mono text-xs text-stone-500"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {formatDuration(entry.durationMinutes)}
                  </span>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="ml-0.5 flex size-5 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-600">
                          <MoreHorizontalIcon className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDelete(entry._id)}
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
                <span className="text-[11px] text-stone-400">{entry.note}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
