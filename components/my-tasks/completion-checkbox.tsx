"use client"

import { useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusIcon } from "@/components/status-icon"
import { getStatusColor } from "@/lib/status-colors"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Id } from "@/convex/_generated/dataModel"

export function CompletionCheckbox({
  isSubmitted,
  onComplete,
}: {
  isSubmitted: boolean
  onComplete: (statusId: Id<"statuses">) => void
}) {
  const [open, setOpen] = useState(false)
  const { statuses } = useTaskReferenceData()

  // Completion statuses: done + review types
  const completionStatuses = (statuses ?? [])
    .filter((s) => s.type === "done" || s.type === "review")
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (isSubmitted) {
    return (
      <Checkbox
        checked
        disabled
        className="data-checked:border-green-500 data-checked:bg-green-500"
      />
    )
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen(true)
  }

  function handleSelect(statusId: Id<"statuses">) {
    setOpen(false)
    onComplete(statusId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div onClick={handleClick}>
          <Checkbox checked={false} />
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-48 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        {completionStatuses.map((status) => (
          <button
            key={status._id}
            type="button"
            onClick={() => handleSelect(status._id)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/50"
          >
            <StatusIcon type={status.type} color={getStatusColor(status.color).dot} size={14} />
            {status.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
