"use client"

import { useSortable } from "@dnd-kit/react/sortable"
import { GripVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function MyTasksSortableRow({
  id,
  index,
  children,
}: {
  id: string
  index: number
  children: React.ReactNode
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
  })

  return (
    <li
      ref={ref}
      className={cn(
        "group/sortable flex w-full list-none items-start rounded-lg transition-colors hover:bg-muted/70",
        isDragging && "z-50 bg-background shadow-sm opacity-90",
      )}
    >
      {/* Drag handle — first flex item, visible on hover */}
      <button
        ref={handleRef}
        type="button"
        className="flex size-6 shrink-0 cursor-grab items-center justify-center pt-[13px] opacity-0 outline-hidden transition-opacity group-hover/sortable:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
      </button>

      {/* Task content — fills remaining space */}
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </li>
  )
}
