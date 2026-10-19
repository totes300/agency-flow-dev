"use client"

/**
 * Inline-editable Hours cell for time entry tables.
 *
 * Click the value → it becomes an input pre-filled with the current
 * duration. Accepts every format `parseDuration` understands ("1:30",
 * "1.5", "90", "1h 30m"). Enter or blur commits, Escape cancels. The
 * Convex subscription refreshes the displayed value after the mutation,
 * so no local mirror of the saved duration is kept.
 *
 * Non-editable rows (locked Draft/Closed entries, or rows the viewer
 * can't edit) render the plain formatted value — same typography, no
 * affordance.
 */

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatMinutes } from "@/lib/format"
import { parseDuration } from "@/lib/duration"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

export function TimeEntryHoursCell({
  entryId,
  durationMinutes,
  editable,
}: {
  entryId: Id<"timeEntries">
  durationMinutes: number
  editable: boolean
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  const [pending, setPending] = useState(false)

  const display = formatMinutes(durationMinutes)

  if (!editable) {
    return <span className="tabular-nums">{display}</span>
  }

  function startEditing() {
    setValue(display)
    setInvalid(false)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setInvalid(false)
  }

  async function commit() {
    if (pending) return
    const parsed = parseDuration(value)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    if (parsed === durationMinutes) {
      cancel()
      return
    }
    setPending(true)
    try {
      await updateEntry({ id: entryId, durationMinutes: parsed })
      setEditing(false)
    } catch (err) {
      toastError(err, "Couldn't update hours")
    } finally {
      setPending(false)
    }
  }

  if (editing) {
    return (
      <input
        // Entered via an explicit click on the value; focus must follow
        // the interaction.
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setInvalid(false)
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        disabled={pending}
        aria-label="Edit hours"
        aria-invalid={invalid || undefined}
        className={cn(
          "h-6 w-16 rounded border border-input bg-background px-1.5 text-right text-sm tabular-nums outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          invalid && "border-destructive focus-visible:ring-destructive/30",
          pending && "opacity-60",
        )}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      aria-label={`Edit hours (${display})`}
      className={cn(
        "-mx-1.5 cursor-text rounded px-1.5 py-0.5 text-right tabular-nums",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {display}
    </button>
  )
}
