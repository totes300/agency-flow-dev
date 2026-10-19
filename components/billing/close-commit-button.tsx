"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toastError } from "@/lib/toast-helpers"
import type { CloseWorkspaceData } from "@/convex/billingViews"

/**
 * The workspace's single primary action, full width in the summary card:
 *   - within-budget retainer → "Close period" (settle + monthly report), then
 *     on to the report page, which carries the worksheet download;
 *   - over-budget retainer / T&M → "Create draft invoice", then on to the
 *     invoice editor.
 * The amount is the card's headline, so the label names only the outcome.
 * The server re-derives scope and price at commit — this button never sends
 * entry ids or amounts. A missing overage rate disables it (the card's check
 * list links to the setting); a running timer only warns.
 */
export function CloseCommitButton({ data }: { data: CloseWorkspaceData }) {
  const router = useRouter()
  const commitClose = useMutation(api.billingCloses.commitClose)
  const [pending, setPending] = useState(false)

  const isCloseReport = data.billingType === "retainer" && data.withinBudget
  const blockedMissingRate = data.issues.includes("missing-overage-rate")

  // Oldest-first / not-elapsed: the server rejects, but disable + explain here.
  const notEarliest = data.issues.includes("not-earliest-open")
  const disabledReason = blockedMissingRate
    ? "Set the project's overage rate first."
    : !data.committable
      ? notEarliest
        ? "Close the earlier open period first."
        : "This period hasn't ended yet."
      : null

  async function commit() {
    if (pending) return
    setPending(true)
    try {
      // One commit for every close: the server re-derives scope and price and
      // creates a draft only when there is money to bill.
      const { invoiceId } = await commitClose({
        projectId: data.project.id,
        periodStart: data.period.start,
      })
      if (invoiceId) {
        router.push(`/invoices/${invoiceId}`)
      } else {
        router.push(`/projects/${data.project.id}/reports/${data.period.end.slice(0, 7)}`)
        toast.success("Period closed")
      }
    } catch (err) {
      toastError(err, "Couldn't complete the close")
      setPending(false)
    }
  }

  const label = isCloseReport ? "Close period" : "Create draft invoice"

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        className="w-full"
        disabled={pending || disabledReason !== null}
        onClick={() => void commit()}
      >
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {label}
      </Button>
      {disabledReason && (
        <p className="text-center text-xs text-muted-foreground">{disabledReason}</p>
      )}
    </div>
  )
}
