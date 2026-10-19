"use client"

import { useState, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { STATUS_COLOR_NAMES, type StatusColorName } from "@/convex/lib/constants"
import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import { cn } from "@/lib/utils"

/**
 * Colour picker for statuses and labels: a quiet ghost trigger showing the
 * current colour (the caller renders the preview — a status icon or a dot),
 * and a popover grid of the shared status palette. Picking closes it.
 */
export function ColorSwatchPicker({
  value,
  onChange,
  children,
  disabled = false,
}: {
  value: StatusColorName
  onChange: (color: StatusColorName) => void
  /** The trigger preview, drawn in the current colour. */
  children: ReactNode
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Colour: ${STATUS_COLOR_CONFIG[value].label}`}
        >
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div role="group" aria-label="Colours" className="grid grid-cols-5 gap-1">
          {STATUS_COLOR_NAMES.map((color) => {
            const cfg = STATUS_COLOR_CONFIG[color]
            const selected = color === value
            return (
              <button
                key={color}
                type="button"
                aria-pressed={selected}
                aria-label={cfg.label}
                title={cfg.label}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                  selected && "bg-muted",
                )}
                onClick={() => {
                  onChange(color)
                  setOpen(false)
                }}
              >
                <span
                  className="flex size-3.5 items-center justify-center rounded-full"
                  style={{ backgroundColor: cfg.dot }}
                >
                  {selected ? <CheckIcon className="size-2.5 text-background" strokeWidth={3} /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Narrows a stored colour string to the palette (unknown values fall back to gray). */
export function toStatusColor(color: string): StatusColorName {
  return (STATUS_COLOR_NAMES as readonly string[]).includes(color) ? (color as StatusColorName) : "gray"
}
