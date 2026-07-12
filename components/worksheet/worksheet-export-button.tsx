"use client"

/**
 * One-click worksheet download for the project Time tab toolbar.
 *
 * Reads the tab's current URL filters (date range, billing status), maps
 * them onto `worksheets.exportAdHoc` via `resolveViewExportParams`, and
 * downloads the CSV immediately — no dialog. The tooltip previews the
 * resolved period so the user knows what they're about to send the client.
 *
 * The fully-custom picker (categories, arbitrary presets) stays available
 * from the project header's "Download worksheet…" menu item.
 */

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useAction } from "convex/react"
import { FileSpreadsheetIcon, Loader2Icon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { downloadCsv } from "@/lib/download"
import { runExportWithToast } from "@/lib/worksheet-toast"
import { parseDateRangePreset } from "@/lib/date-buckets"
import { resolveViewExportParams } from "@/lib/worksheet-view-export"

export function WorksheetExportButton({
  projectId,
  projectStartDate,
  timezone,
}: {
  projectId: Id<"projects">
  /** Project start date (`YYYY-MM-DD`) — lower bound for all-time exports. */
  projectStartDate?: string
  timezone: string
}) {
  const searchParams = useSearchParams()
  const exportAdHoc = useAction(api.worksheets.exportAdHoc)
  const [pending, setPending] = useState(false)

  const dateRange = parseDateRangePreset(searchParams.get("dateRange"))
  const exportParams = resolveViewExportParams({
    dateRange,
    customFrom: searchParams.get("from") ?? undefined,
    customTo: searchParams.get("to") ?? undefined,
    billingStatus: searchParams.get("billingStatus"),
    timezone,
    projectStartDate,
  })

  async function handleClick() {
    if (pending) return
    setPending(true)
    try {
      await runExportWithToast({
        run: () =>
          exportAdHoc({
            projectId,
            periodStart: exportParams.periodStart,
            periodEnd: exportParams.periodEnd,
            periodSlug: exportParams.periodSlug,
            periodLabel: exportParams.periodLabel,
            billable: exportParams.billable,
          }),
        onResult: ({ csv, filename }) => downloadCsv(csv, filename),
      })
    } catch {
      // runExportWithToast already surfaced the error toast.
    } finally {
      setPending(false)
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={pending}
            onClick={() => void handleClick()}
          >
            {pending ? (
              <Loader2Icon
                data-icon="inline-start"
                className="size-4 animate-spin"
                aria-hidden
              />
            ) : (
              <FileSpreadsheetIcon
                data-icon="inline-start"
                className="size-4"
                aria-hidden
              />
            )}
            {pending ? "Generating…" : "Worksheet"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Download worksheet — {exportParams.periodLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
