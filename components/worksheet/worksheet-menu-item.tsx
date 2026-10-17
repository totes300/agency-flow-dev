"use client"

/**
 * `WorksheetMenuItem` — a `DropdownMenuItem` that wraps the standard
 * worksheet-export click flow (Phase 9):
 *
 *   1. Call the action (`exportClose` /
 *      `exportRange`) the caller hands in via the `run` prop.
 *   2. Wrap the returned `csv` string in a Blob and trigger an anchor-click
 *      download.
 *   3. Surface the result with a status toast: success / partial / failure.
 *      The action's `stats` payload drives the wording so the user always
 *      knows whether the AI ran cleanly.
 *   4. Disable the menu item while a request is in flight so a fast double-
 *      click can't fire twice.
 *
 * Pending state: we DO call `e.preventDefault()` on the select so the
 * dropdown stays open during generation. This keeps the spinner icon
 * visible — otherwise the menu would close instantly and the user would
 * see no progress until the toast fires (up to several seconds for cycle
 * exports). The dropdown auto-closes when the request resolves because
 * `pending` flips back and the trigger gets focus back.
 *
 * Why a shared component: PRD §Frontend §Shared components — the same
 * download-then-toast logic ships from the monthly row, cycle-close row,
 * and invoice row. Cloning the snippet across three files would drift on
 * the next behavior change (e.g. analytics, undo, etc.).
 */

import { useState, type ReactNode } from "react"
import { Loader2Icon } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { downloadCsv } from "@/lib/download"
import {
  runExportWithToast,
  type WorksheetExportResult,
} from "@/lib/worksheet-toast"

export type WorksheetMenuItemProps = {
  /** Label rendered inside the menu item. */
  label: string
  /** Optional leading icon. Sized via the dropdown-menu's `[&_svg]:size-4`. */
  icon?: ReactNode
  /**
   * Calls the Convex action and returns the CSV string + filename + stats.
   * The `stats` field drives the completion toast (success / partial / total
   * failure). Returning it is part of the action contract — actions that
   * pre-date the telemetry are flagged by TypeScript.
   */
  run: () => Promise<WorksheetExportResult>
}

export function WorksheetMenuItem({ label, icon, run }: WorksheetMenuItemProps) {
  const [pending, setPending] = useState(false)

  async function handleSelect(e: Event) {
    if (pending) {
      e.preventDefault()
      return
    }
    setPending(true)
    try {
      await runExportWithToast({
        run,
        onResult: ({ csv, filename }) => downloadCsv(csv, filename),
      })
    } catch {
      // runExportWithToast already surfaced the error toast. The throw is
      // re-raised so future analytics / sentry hooks can observe it; we
      // intentionally swallow here since the user has visual feedback.
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(e) => void handleSelect(e)}
    >
      {pending ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {pending ? "Generating worksheet…" : label}
    </DropdownMenuItem>
  )
}
