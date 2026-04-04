"use client"

import { useState, useRef, useCallback } from "react"
import { StatusIcon } from "@/components/status-icon"
import { getStatusColor } from "@/lib/status-colors"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { STATUS_TYPES } from "@/convex/lib/constants"
import { TYPE_LABELS } from "@/lib/display-constants"
import type { Id } from "@/convex/_generated/dataModel"

const LONG_PRESS_MS = 500

export function CompletionCheckbox({
  isSubmitted,
  defaultStatusId,
  onComplete,
}: {
  isSubmitted: boolean
  defaultStatusId?: Id<"statuses">
  onComplete: (statusId: Id<"statuses">) => void
}) {
  const [open, setOpen] = useState(false)
  const [animating, setAnimating] = useState(false)
  const { statuses } = useTaskReferenceData()
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPress = useRef(false)

  // All statuses grouped by type for the popover
  const allStatuses = (statuses ?? []).sort((a, b) => a.sortOrder - b.sortOrder)

  const clearTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Completed state — disabled green checkbox
  if (isSubmitted) {
    return (
      <div className="flex size-4 items-center justify-center">
        <svg viewBox="0 0 16 16" className="size-4">
          <rect
            x="0.5" y="0.5" width="15" height="15" rx="3"
            className="fill-green-500 stroke-green-500"
            strokeWidth="1"
          />
          <path
            d="M4.5 8.5L7 11L11.5 5.5"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  // Animating state — plays check animation then completes
  if (animating) {
    return (
      <div className="flex size-4 items-center justify-center">
        <svg viewBox="0 0 16 16" className="size-4 animate-check-bounce">
          <rect
            x="0.5" y="0.5" width="15" height="15" rx="3"
            className="animate-check-fill"
            strokeWidth="1"
          />
          <path
            d="M4.5 8.5L7 11L11.5 5.5"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-check-draw"
            style={{
              strokeDasharray: 14,
              strokeDashoffset: 14,
            }}
          />
        </svg>
      </div>
    )
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    isLongPress.current = false

    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true
      setOpen(true)
    }, LONG_PRESS_MS)
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()

    // If long press already opened popover, do nothing
    if (isLongPress.current) {
      isLongPress.current = false
      return
    }

    clearTimer()

    if (defaultStatusId) {
      // Immediate completion with animation
      setAnimating(true)
      setTimeout(() => {
        onComplete(defaultStatusId)
      }, 300)
    } else {
      // No default configured — fallback to popover
      setOpen(true)
    }
  }

  function handlePointerLeave() {
    // Only clear the timer if popover hasn't opened yet
    if (!isLongPress.current) {
      clearTimer()
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    clearTimer()
    setOpen(true)
  }

  function handleSelect(statusId: Id<"statuses">) {
    setOpen(false)
    setAnimating(true)
    setTimeout(() => {
      onComplete(statusId)
    }, 300)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className="flex size-4 cursor-pointer items-center justify-center"
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onClick={handleClick}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
        >
          <svg viewBox="0 0 16 16" className={cn("size-4 transition-colors")}>
            <rect
              x="0.5" y="0.5" width="15" height="15" rx="3"
              fill="none"
              className="stroke-muted-foreground/40 transition-colors hover:stroke-muted-foreground/70"
              strokeWidth="1"
            />
          </svg>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-52 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_TYPES.map((type) => {
          const typeStatuses = allStatuses.filter((s) => s.type === type)
          if (typeStatuses.length === 0) return null
          return (
            <div key={type}>
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {TYPE_LABELS[type]}
              </div>
              {typeStatuses.map((status) => (
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
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
