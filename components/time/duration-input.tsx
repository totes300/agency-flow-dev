"use client"

import { useState, useEffect } from "react"
import { parseDuration, formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"

const QUICK_BUTTONS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "8h", minutes: 480 },
]

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
  const parsed = parseDuration(value)

  return (
    <div className={cn("flex flex-col", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-mono text-sm text-stone-900 outline-none placeholder:text-stone-300"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
        placeholder="0h 00m"
        autoFocus={autoFocus}
      />
      {showQuickButtons && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_BUTTONS.map((btn) => (
            <button
              key={btn.label}
              type="button"
              onClick={() => onChange(btn.label)}
              className="rounded-md bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200"
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
