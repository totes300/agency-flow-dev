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
 * Phase 8 Slice 4 — "Close cycle" confirm modal for rollover retainer
 * cycles. Sibling of `ClosePeriodModal` (Slice 3) with three differences:
 *
 *   1. Calls `closeRetainerCycle` (bulk-closes N monthly periods with
 *      identical `closedAt`) instead of `closePeriod`.
 *   2. The preview reads `getRetainerStatement` for the CYCLE-END month —
 *      rollover statements already include `cycleToDate` aggregates, so a
 *      single statement render shows both the closing month AND the
 *      cycle-wide totals admins need to review before locking.
 *   3. The reversibility line is plural ("reopen any month in this
 *      cycle"), because per-month reopen via `reopenPeriod` (Slice 3)
 *      still works on individual months even after a cycle close — the
 *      monthly boundary stamped on each entry is what makes that safe.
 *
 * Same Revision Pass #2 contract — no `send` / `delivery` / persisted
 * statement language. The artifact is the live render.
 */
export function CloseCycleModal({
  open,
  onOpenChange,
  projectId,
  cycleStart,
  cycleEndYear,
  cycleEndMonth,
  cycleLabel,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  projectId: Id<"projects">
  cycleStart: string         // YYYY-MM-01 — the natural key for `closeRetainerCycle`
  cycleEndYear: number
  cycleEndMonth: number      // 1-indexed — final month of the cycle
  cycleLabel: string         // e.g. "Q1 2026" or "Jan-Mar 2026"
}) {
  const closeCycle = useMutation(api.retainerPeriods.closeRetainerCycle)
  const report = useQuery(
    api.statements.getRetainerStatement,
    open ? { projectId, year: cycleEndYear, month: cycleEndMonth } : "skip",
  )
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    if (pending) return
    setPending(true)
    try {
      const { closedPeriods, settledCount } = await closeCycle({
        projectId,
        cycleStart,
      })
      toast.success(
        settledCount > 0
          ? `Closed ${cycleLabel} — ${closedPeriods} ${
              closedPeriods === 1 ? "month" : "months"
            }, ${settledCount} ${
              settledCount === 1 ? "entry" : "entries"
            } settled.`
          : `Closed ${cycleLabel} — ${closedPeriods} ${
              closedPeriods === 1 ? "month" : "months"
            }.`,
      )
      onOpenChange(false)
    } catch (err) {
      toastError(err, "Failed to close cycle")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Review &amp; close {cycleLabel} cycle</DialogTitle>
          <DialogDescription>
            Closing locks every hour logged across this cycle. The retainer
            fee covers them — no extra invoice is generated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {report === undefined ? (
            <ReportPreviewSkeleton />
          ) : report === null ? (
            <p className="text-sm text-muted-foreground">
              Cycle preview is unavailable.
            </p>
          ) : (
            <MonthlyReportDocument report={report} />
          )}
        </div>

        <DialogFooter className="rounded-none border-t bg-muted/30 px-6 py-3">
          <p className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
            <RotateCcwIcon className="size-3.5" aria-hidden />
            You can reopen any month in this cycle anytime if you need to
            make changes.
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
              {pending ? "Closing…" : "Close cycle"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReportPreviewSkeleton() {
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
