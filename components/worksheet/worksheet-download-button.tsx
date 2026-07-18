"use client"

/**
 * `WorksheetDownloadButton` — the standalone-button sibling of
 * `WorksheetMenuItem`, for surfaces where the worksheet is a primary action
 * rather than a menu entry (invoice editor, closed-period Monthly Report).
 *
 * Same contract: `run` calls a worksheet export action; the shared
 * `runExportWithToast` drives the loading → success/partial/error toast and
 * the CSV downloads via an anchor click. The button disables while a request
 * is in flight so a fast double-click can't fire twice.
 */

import { useState } from "react"
import { FileSpreadsheetIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { downloadCsv } from "@/lib/download"
import {
  runExportWithToast,
  type WorksheetExportResult,
} from "@/lib/worksheet-toast"

export function WorksheetDownloadButton({
  run,
  label = "Download worksheet",
  variant = "default",
  size = "sm",
  className,
}: {
  /** Calls the Convex export action (`exportInvoice`, `exportSettledPeriod`, …). */
  run: () => Promise<WorksheetExportResult>
  label?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
}) {
  const [pending, setPending] = useState(false)

  async function handleClick() {
    if (pending) return
    setPending(true)
    try {
      await runExportWithToast({
        run,
        onResult: ({ csv, filename }) => downloadCsv(csv, filename),
      })
    } catch {
      // runExportWithToast already surfaced the error toast; swallow so the
      // button just returns to idle.
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      onClick={() => void handleClick()}
    >
      {pending ? (
        <Loader2Icon data-icon="inline-start" className="size-3.5 animate-spin" />
      ) : (
        <FileSpreadsheetIcon data-icon="inline-start" className="size-3.5" />
      )}
      {pending ? "Generating…" : label}
    </Button>
  )
}
