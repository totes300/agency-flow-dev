"use client"

import type { ComponentProps } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

/**
 * A two-or-more option segmented control (prototype v4 `.seg`): a muted track
 * with the selected option raised. Built on the shadcn ToggleGroup (single).
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ToggleGroup>, "type" | "value" | "onValueChange" | "defaultValue"> & {
  value: T
  onValueChange: (value: T) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => { if (next) onValueChange(next as T) }}
      className={cn("grid auto-cols-fr grid-flow-col rounded-lg bg-muted p-[3px]", className)}
      {...props}
    >
      {children}
    </ToggleGroup>
  )
}

export function SegmentedItem({ className, ...props }: ComponentProps<typeof ToggleGroupItem>) {
  return (
    <ToggleGroupItem
      className={cn("h-8 font-normal data-[state=on]:bg-background data-[state=on]:font-medium data-[state=on]:shadow-xs", className)}
      {...props}
    />
  )
}
