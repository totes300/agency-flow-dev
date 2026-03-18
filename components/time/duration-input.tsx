"use client"

import { cn } from "@/lib/utils"
import { QUICK_DURATIONS } from "@/lib/duration"
import { Button } from "@/components/ui/button"

export function DurationInput({
  value,
  onChange,
  showQuickButtons = true,
  autoFocus = false,
  className,
}: {
  value: string
  onChange: (value: string) => void
  showQuickButtons?: boolean
  autoFocus?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
        placeholder="0h 00m"
        aria-label="Duration"
        autoFocus={autoFocus}
      />
      {showQuickButtons && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_DURATIONS.map((btn) => (
            <Button
              key={btn.label}
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => onChange(btn.label)}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
