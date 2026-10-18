"use client"

import { PlusIcon } from "lucide-react"

/** Shared "+ Add task…" pill button used across task views. */
export function InlineAddButton({ onClick, label = "Add task..." }: { onClick: () => void; label?: string }) {
  return (
    <div className="py-1.5">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
      >
        <PlusIcon className="size-3.5" />
        {label}
      </button>
    </div>
  )
}
