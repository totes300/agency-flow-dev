"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { api } from "@/convex/_generated/api"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration, QUICK_DURATIONS } from "@/lib/duration"
import { formatShortDate } from "@/lib/format"
import { TimeEntriesList } from "@/components/time/time-entries-list"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ClockIcon, AlignLeftIcon, ChevronDownIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

export function TimeLogPopover({
  taskId,
  isBillable,
  children,
}: {
  taskId: Id<"tasks">
  isBillable: boolean
  children: React.ReactNode
}) {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const { startTimer } = useTimerActions()
  const createEntry = useMutation(api.timeEntries.create)
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")

  const isAdmin = membership?.role === "org:admin"

  // Admin: load org members for the user selector
  const orgMembers = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated && isAdmin ? {} : "skip",
  )

  const [open, setOpen] = useState(false)
  const [durationStr, setDurationStr] = useState("")
  const [note, setNote] = useState("")
  const [billable, setBillable] = useState(isBillable)
  const [saving, setSaving] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<Id<"users"> | null>(null)

  const entries = useQuery(
    api.timeEntries.listByTask,
    isAuthenticated && open ? { taskId } : "skip",
  )
  const [entriesExpanded, setEntriesExpanded] = useState(false)
  const totalMinutes = entries?.reduce((sum, e) => sum + e.durationMinutes, 0) ?? 0

  // Resolve selected user display info
  const effectiveUserId = selectedUserId ?? currentUser?._id
  const selectedMember = isAdmin && selectedUserId && orgMembers
    ? orgMembers.find((m) => m._id === selectedUserId)
    : null
  const displayName = selectedMember?.name ?? currentUser?.name ?? "You"
  const displayInitials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?"

  function resetForm() {
    setDurationStr("")
    setNote("")
    setBillable(isBillable)
    setEntriesExpanded(false)
    setSelectedUserId(null)
  }

  async function handleSave() {
    const minutes = parseDuration(durationStr)
    if (!minutes) {
      toast.error("Enter a valid duration")
      return
    }
    setSaving(true)
    try {
      await createEntry({
        taskId,
        durationMinutes: minutes,
        note: note.trim() || undefined,
        isBillable: billable,
        ...(isAdmin && selectedUserId ? { userId: selectedUserId } : {}),
      })
      toast.success(`${formatDuration(minutes)} logged`)
      resetForm()
    } catch (err) {
      toastError(err, "Failed to log time")
    } finally {
      setSaving(false)
    }
  }

  async function handlePlayClick() {
    try {
      await startTimer(taskId)
      setOpen(false)
    } catch (err) {
      toastError(err, "Failed to start timer")
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm() }}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0"
        align="start"
        sideOffset={4}
      >
        {/* User selector (admin) or current user label */}
        {isAdmin && orgMembers ? (
          <div className="border-b border-border/40 px-4 py-2.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 text-sm">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                    <span className="text-[9px] font-semibold text-muted-foreground">{displayInitials}</span>
                  </div>
                  <span className="font-medium text-foreground">{displayName}</span>
                  <ChevronDownIcon className="size-3 text-muted-foreground" strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {orgMembers.map((member) => (
                  <DropdownMenuItem
                    key={member._id}
                    onClick={() => setSelectedUserId(
                      member._id === currentUser?._id ? null : member._id,
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                        <span className="text-[8px] font-semibold text-muted-foreground">
                          {member.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?"}
                        </span>
                      </div>
                      <span>{member.name}</span>
                      {member._id === effectiveUserId && (
                        <span className="ml-auto text-xs text-muted-foreground">selected</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}

        {/* Duration input + play button */}
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
          <input
            type="text"
            value={durationStr}
            onChange={(e) => setDurationStr(e.target.value)}
            className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
            placeholder="0h 00m"
            aria-label="Duration"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
          />
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={handlePlayClick}
            className="rounded-full"
            aria-label="Start timer"
          >
            <PlayIcon className="size-3.5" fill="currentColor" strokeWidth={0} />
          </Button>
        </div>

        {/* Quick buttons */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/40 px-4 py-2.5">
          {QUICK_DURATIONS.map((btn) => (
            <Button
              key={btn.label}
              variant="secondary"
              size="xs"
              onClick={() => setDurationStr(btn.label)}
            >
              {btn.label}
            </Button>
          ))}
        </div>

        {/* Icon rows: date + note */}
        <div className="flex flex-col px-4 py-1.5">
          <div className="flex items-center gap-2.5 border-b border-border/40 py-2">
            <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">
              Today, {formatShortDate(new Date().toISOString().slice(0, 10))}
            </span>
          </div>
          <div className="flex items-center gap-2.5 py-2">
            <AlignLeftIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              placeholder="Add a note"
              aria-label="Note"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            />
          </div>
        </div>

        {/* Billable + Save */}
        <div className="flex items-center justify-between border-t border-border/40 px-4 py-2.5">
          {isBillable ? (
            <div className="flex items-center gap-2">
              <Switch checked={billable} onCheckedChange={setBillable} />
              <span className="text-sm text-muted-foreground">Billable</span>
            </div>
          ) : (
            <div />
          )}
          <Button onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </div>

        {/* Time entries section */}
        {entries && entries.length > 0 && (
          <>
            <div className="h-px bg-border" />
            <div className="flex flex-col px-4 py-2.5">
              <button
                onClick={() => setEntriesExpanded(prev => !prev)}
                className="flex items-center justify-between"
                aria-expanded={entriesExpanded}
              >
                <div className="flex items-center gap-1.5">
                  <ChevronDownIcon
                    className={cn(
                      "size-3 text-muted-foreground transition-transform duration-150",
                      !entriesExpanded && "-rotate-90",
                    )}
                    strokeWidth={2}
                  />
                  <span className="text-xs font-medium text-muted-foreground">Time entries</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDuration(totalMinutes)}
                </span>
              </button>
              {entriesExpanded && (
                <div className="mt-2.5">
                  <TimeEntriesList
                    entries={entries}
                    isAdmin={isAdmin}
                    currentUserId={currentUser?._id}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
