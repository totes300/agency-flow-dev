"use client"

import { cn } from "@/lib/utils"
import type { SystemViewOption } from "@/components/task-view/view-state"

/**
 * Pill view tabs (U1/U5) — the only pills in the toolbar. Slice 3 lists the
 * system views; saved personal/workspace views join in slice 4. The active
 * tab carries a dot while the URL differs from the view's spec.
 */
export function ViewTabs({
  views,
  activeKey,
  modified,
  onSelect,
}: {
  views: readonly SystemViewOption[]
  activeKey: string
  modified: boolean
  onSelect: (key: string) => void
}) {
  return (
    <div role="tablist" aria-label="Views" className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {views.map((view) => {
        const active = view.key === activeKey
        return (
          <button
            key={view.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              "relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              active
                ? "bg-foreground/[0.07] font-medium text-foreground"
                : "bg-background text-muted-foreground ring-1 ring-border ring-inset hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => onSelect(view.key)}
          >
            {view.name}
            {active && modified ? (
              <span className="size-1.5 rounded-full bg-primary" aria-label="Modified" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
