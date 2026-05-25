"use client"

import { useState } from "react"
import { RotateCcwIcon } from "lucide-react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MonthlyReportDocument } from "@/components/projects/monthly-report-document"
import { toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"

/**
 * Phase 8 Slice 3 — "Close period" confirm modal for retainer within-budget
 * months.
 *
 * Principle #1 (Revision Pass) — `Close` is NOT a one-click action; the
 * admin reviews the live Monthly Report preview first, then confirms. The
 * preview is read straight from `api.statements.getRetainerStatement` so
 * the confirm-time view matches what `/projects/[id]/reports/[period]`
 * renders pixel-for-pixel.
 *
 * Principle #4 — calm reversibility line in the body. The point is to
 * lower the perceived consequence of clicking close so admins actually use
 * it; reopen is one click away.
 *
 * Revision Pass #2 — copy deliberately avoids "send", "delivery",
 * "downloaded by", or any persisted statement language. There is no
 * `statements` table, no statement number, no `sentAt`. The artifact is a
 * live render.
 */
export function ClosePeriodModal({
  open,
  onOpenChange,
  projectId,
  year,
  month,
  periodStart,
  periodLabel,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  projectId: Id<"projects">
  year: number
  month: number          // 1-indexed
  periodStart: string    // YYYY-MM-01 — the natural key for `closePeriod`
  periodLabel: string    // "March 2026" — header copy
}) {
  const closePeriod = useMutation(api.retainerPeriods.closePeriod)
  // Only fetch the preview when the modal is actually open — a closed
  // modal must not pay the read cost or trigger reactive subscriptions
  // for every retainer row on the page.
  const report = useQuery(
    api.statements.getRetainerStatement,
    open ? { projectId, year, month } : "skip",
  )
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    if (pending) return
    setPending(true)
    try {
      const { settledCount } = await closePeriod({ projectId, periodStart })
      toast.success(
        settledCount > 0
          ? `Closed ${periodLabel} — ${settledCount} ${
              settledCount === 1 ? "entry" : "entries"
            } settled.`
          : `Closed ${periodLabel}.`,
      )
      onOpenChange(false)
    } catch (err) {
      toastError(err, "Failed to close period")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Review &amp; close {periodLabel}</DialogTitle>
          <DialogDescription>
            Closing locks every hour logged in this month. The retainer fee
            covers them — no extra invoice is generated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {report === undefined ? (
            <ReportPreviewSkeleton />
          ) : report === null ? (
            <p className="text-sm text-muted-foreground">
              Report preview is unavailable for this month.
            </p>
          ) : (
            <MonthlyReportDocument report={report} />
          )}
        </div>

        <DialogFooter className="rounded-none border-t bg-muted/30 px-6 py-3">
          <p className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
            <RotateCcwIcon className="size-3.5" aria-hidden />
            You can reopen this month anytime if you need to make changes.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={pending || report === undefined}
            >
              {pending ? "Closing…" : "Close period"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReportPreviewSkeleton() {
  // Mirrors `MonthlyReportDocument`'s structural shape (header strip,
  // parties grid, usage table) so the modal doesn't lurch when the query
  // resolves. CLAUDE.md: skeletons must be content-aware, not generic
  // placeholder rectangles.
  return (
    <div className="flex flex-col gap-8 rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-16 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
