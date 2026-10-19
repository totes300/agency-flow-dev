"use client"

import type { CSSProperties } from "react"
import { PlusIcon } from "lucide-react"
import { InlineAddButton } from "@/components/inline-add-button"
import { useInlineAdd } from "@/lib/hooks/use-inline-add"
import { cn } from "@/lib/utils"
import { ROW_GRID_CLASS, ROW_GRID_COMPACT_CLASS } from "@/components/task-view/task-row"

/**
 * The inline "add task" row at the end of a group (§11.7): the shared quiet
 * "+ Add task…" button, then a title input on the row grid, aligned with the
 * Task column. Enter creates the task (prefilled by the group, see
 * `inlineAddPrefill`) and keeps the input open for the next one; Esc, or
 * leaving it empty, closes it. Built on the app's `useInlineAdd` hook.
 */
export function InlineAddRow({
  titleColumn,
  groupLabel,
  onCreate,
  compact = false,
  placeholder = "Task name…",
  addLabel,
}: {
  /** 1-based grid column of the Task track. */
  titleColumn: number
  groupLabel: string
  onCreate: (title: string) => void
  /** Compact grid (task detail sub-tasks). */
  compact?: boolean
  placeholder?: string
  /** Label of the "+ Add …" button (default "Add task…"). */
  addLabel?: string
}) {
  const { active, title, setTitle, inputRef, activate, handleKeyDown, handleBlur } = useInlineAdd(onCreate)
  const cell = { gridColumnStart: titleColumn } as CSSProperties

  return (
    <div role="row" className={cn(compact ? ROW_GRID_COMPACT_CLASS : ROW_GRID_CLASS, compact ? "h-9" : "h-10 border-b border-border/60", "text-[13px]")}>
      <div role="gridcell" style={cell} className="flex min-w-0 items-center gap-1.5">
        {active ? (
          <>
            <PlusIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholder}
              aria-label={groupLabel ? `New task in ${groupLabel}` : "New task"}
              className="min-w-0 flex-1 bg-transparent font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
            />
          </>
        ) : (
          <div className="-ml-2.5">
            <InlineAddButton onClick={activate} label={addLabel} />
          </div>
        )}
      </div>
    </div>
  )
}
