"use client"

import { useSortable } from "@dnd-kit/react/sortable"
import { GripVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function SortableTaskRow({
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
        isDragging && "z-50 bg-background shadow-sm opacity-90",
      )}
    >
      {/* Drag handle — visible on hover, overlays left padding */}
      {!disabled && (
        <div
          ref={handleRef}
          role="button"
          tabIndex={0}
          className="absolute -left-13 top-0 bottom-0 z-10 flex w-3 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover/sortable:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
          aria-roledescription="sortable"
        >
          <GripVerticalIcon className="size-3.5 text-muted-foreground/80" />
        </div>
      )}
      {children}
    </div>
  )
}
