"use client"

import { AlertTriangleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pluralize } from "@/lib/format"

/**
 * Rendered when the current filter hides some rows of an active selection.
 *
 * The Time tab preserves selection across filter changes (Linear/Notion
 * pattern) so a user who selects 20 rows, narrows the date range, then
 * clicks "Create Invoice" doesn't get a surprising "3 entries invoiced"
 * result when they thought they'd picked 20. This banner makes the otherwise
 * invisible state visible.
 */
export function ProjectTimeHiddenSelectionBanner({
  hiddenCount,
  totalCount,
  onClearSelection,
}: {
  hiddenCount: number
  totalCount: number
  onClearSelection: () => void
}) {
  if (hiddenCount === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangleIcon aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">
        <span className="font-medium tabular-nums">{hiddenCount}</span> of{" "}
        <span className="font-medium tabular-nums">{totalCount}</span>{" "}
        {pluralize(totalCount, "selected entry is", "selected entries are")}{" "}
        hidden by the current filter. Bulk actions will still apply to the full
        selection.
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onClearSelection}
        className="h-7 px-2 text-amber-900 hover:bg-amber-100/70 hover:text-amber-900 dark:text-amber-200 dark:hover:bg-amber-900/40 dark:hover:text-amber-100"
      >
        Clear selection
      </Button>
    </div>
  )
}
