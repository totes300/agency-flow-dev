"use client"

import { useSortable } from "@dnd-kit/react/sortable"
import { GripVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function MyTasksSortableRow({
  id,
  index,
  disabled,
  children,
}: {
  id: string
  index: number
  disabled?: boolean
  children: React.ReactNode
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    disabled,
  })

  return (
    <div
      ref={ref}
      className={cn(
        "group/sortable relative",
        isDragging && "z-50 rounded-md bg-background shadow-lg ring-1 ring-border/50",
      )}
    >
      {!disabled && (
        <div
          ref={handleRef}
          role="button"
          tabIndex={0}
          className="absolute -left-3.5 top-2.5 z-10 flex size-5 cursor-grab items-center justify-center rounded opacity-0 transition-opacity group-hover/sortable:opacity-60 focus-visible:opacity-60 active:cursor-grabbing active:opacity-100"
          aria-label="Drag to reorder"
          aria-roledescription="sortable"
        >
          <GripVerticalIcon className="size-3 text-muted-foreground" />
        </div>
      )}
      {children}
    </div>
  )
}
