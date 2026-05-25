"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toastError } from "@/lib/toast-helpers"
import { formatMinutes } from "@/lib/format"

/**
 * Phase 8 Slice 3 — confirm dialog for `reopenPeriod`. AlertDialog (vs
 * Dialog) because reopening is a one-line destructive-ish decision: no
 * preview to review, just the consequence.
 *
 * Consequence line spells out what happens (N hours become editable
 * again) so the admin can predict the blast radius before clicking. The
 * "download a fresh report" hint matches the parent PRD's reopen copy
 * minus the "downloaded by … on …" wording (Revision Pass #2 — no
 * persisted statement artifact).
 */
export function ReopenPeriodDialog({
  open,
  onOpenChange,
  projectId,
  periodStart,
  periodLabel,
  workedMinutes,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  projectId: Id<"projects">
  periodStart: string
  periodLabel: string
  workedMinutes: number
}) {
  const reopenPeriod = useMutation(api.retainerPeriods.reopenPeriod)
  const [pending, setPending] = useState(false)

  const hoursLabel = formatMinutes(workedMinutes)

  async function handleConfirm() {
    if (pending) return
    setPending(true)
    try {
      const { reopenedCount } = await reopenPeriod({ projectId, periodStart })
      toast.success(
        reopenedCount > 0
          ? `Reopened ${periodLabel} — ${reopenedCount} ${
              reopenedCount === 1 ? "entry" : "entries"
            } unlocked.`
          : `Reopened ${periodLabel}.`,
      )
      onOpenChange(false)
    } catch (err) {
      toastError(err, "Failed to reopen period")
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen {periodLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            The {hoursLabel} of closed hours in this month become editable
            again. Download a fresh report if you change anything.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={pending}>
            {pending ? "Reopening…" : "Reopen period"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
