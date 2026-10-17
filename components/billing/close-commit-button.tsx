"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import type { CloseWorkspaceData } from "@/convex/close"

/**
 * The workspace's single primary action (PRD stories 24–27), flipping live with
 * the budget line:
 *   - within-budget retainer → "Close & report" (settle + Monthly Report),
 *     then navigate forward to the report page — the page that carries the
 *     "Download worksheet" action, the owner's primary post-close deliverable
 *     (story 26 re-amended with the ledger rebuild).
 *   - over-budget retainer / T&M → "Generate invoice draft · $X", then
 *     navigate forward to the invoice editor (which carries the same
 *     worksheet download).
 *
 * Server re-derives scope at commit — this button never sends entry ids or
 * amounts. Missing overage rate blocks Generate (settings link); a running
 * timer is only a checklist warning and never blocks here.
 */
export function CloseCommitButton({ data }: { data: CloseWorkspaceData }) {
  const router = useRouter()
  const commitClose = useMutation(api.billingCloses.commitClose)
  const [pending, setPending] = useState(false)

  const isCloseReport = data.billingType === "retainer" && data.withinBudget
  const blockedMissingRate = data.issues.includes("missing-overage-rate")

  // Oldest-first / not-elapsed: the server rejects, but disable + explain here.
  const notEarliest = data.issues.includes("not-earliest-open")
  const disabledReason = !data.committable
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
        toast.success("Period closed & reported")
      }
    } catch (err) {
      toastError(err, "Couldn't complete the close")
      setPending(false)
    }
  }

  if (blockedMissingRate) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-destructive">No overage rate set</span>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/${data.project.id}?tab=settings`}>
            Set rate
          </Link>
        </Button>
      </div>
    )
  }

  const label = isCloseReport
    ? "Close & report"
    : `Generate invoice draft · ${formatCurrency(data.amount, data.currency)}`

  return (
    // Default size, not sm — this is the page's single primary action and
    // must survive visually next to the money line and toolbar.
    <Button
      className="shrink-0"
      disabled={pending || !data.committable}
      title={disabledReason ?? undefined}
      onClick={() => void commit()}
    >
      {pending ? "Working…" : label}
    </Button>
  )
}
