"use client"

import { ClipboardListIcon } from "lucide-react"

export function TimeLogPlaceholder() {
  return (
    <div className="rounded-lg border bg-muted/30 p-8">
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
          <ClipboardListIcon className="size-5 text-muted-foreground/60" />
        </div>
        <div>
          <p className="text-sm font-medium">No time logged yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Assign tasks and start tracking to see monthly breakdown.
          </p>
        </div>
      </div>
    </div>
  )
}
