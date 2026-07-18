"use client"

import Link from "next/link"
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  summarizeCloseFlags,
  type CloseFlag,
  type CloseFlagKind,
  type CloseFlagSummary,
} from "@/convex/lib/closeFlags"
import { cn } from "@/lib/utils"

/**
 * Review state as quiet toolbar chips — the demoted successor of the old
 * gray checklist callout. The visual hierarchy of the close is money line →
 * ledger; review aids are tools, so they live with the other tools (Filter /
 * Group by) as ghost buttons: amber icon + muted text, counts in the copy,
 * never a filled pill. Entry-backed chips toggle the ledger's issue lens;
 * the running-timer chip is informational. Nothing renders when the period
 * is clean — the absence of chips IS the all-clear.
 *
 * The blocking overage-rate flag is deliberately NOT a chip — it stops the
 * commit, so it gets a real alert line (`CloseBlockingAlert`).
 */
export function CloseReviewChips({
  flags,
  activeFilter,
  onToggleFilter,
}: {
  flags: CloseFlag[]
  activeFilter: CloseFlagKind | null
  onToggleFilter: (kind: CloseFlagKind) => void
}) {
  const summaries = summarizeCloseFlags(flags).filter(
    (s) => s.kind !== "missing-overage-rate",
  )
  if (summaries.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {summaries.map((summary) => (
        <ReviewChip
          key={summary.kind}
          summary={summary}
          active={activeFilter === summary.kind}
          onToggle={() => onToggleFilter(summary.kind)}
        />
      ))}
    </div>
  )
}

function ReviewChip({
  summary,
  active,
  onToggle,
}: {
  summary: CloseFlagSummary
  active: boolean
  onToggle: () => void
}) {
  const filterable = summary.entryIds.length > 0
  const icon =
    summary.severity === "warning" ? (
      <TriangleAlertIcon
        aria-hidden
        className="size-3.5 text-amber-600 dark:text-amber-500"
      />
    ) : (
      <span
        aria-hidden
        className="mx-0.5 size-1.5 rounded-full bg-muted-foreground/50"
      />
    )

  if (!filterable) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
        {icon}
        {chipLabel(summary)}
      </span>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      title={active ? "Show all entries" : "Show only these entries"}
      onClick={onToggle}
      className={cn(
        "h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {icon}
      {chipLabel(summary)}
    </Button>
  )
}

function chipLabel(summary: CloseFlagSummary): string {
  const n = summary.count
  switch (summary.kind) {
    case "running-timer":
      return n === 1 ? "Timer running" : `${n} timers running`
    case "long-entry":
      return n === 1 ? "1 entry over 8h" : `${n} entries over 8h`
    case "missing-note":
      return n === 1 ? "1 missing note" : `${n} missing notes`
    case "carried-in":
      return n === 1 ? "1 carried in" : `${n} carried in`
    // Filtered out by the caller; exhaustiveness keeps TS honest.
    case "missing-overage-rate":
      return "Over budget with no overage rate"
  }
}

/**
 * The one review state that DESERVES loudness: an over-budget retainer with
 * no overage rate blocks Generate. Renders as a slim alert above the ledger
 * only while the condition holds.
 */
export function CloseBlockingAlert({
  flags,
  projectId,
}: {
  flags: CloseFlag[]
  projectId: Id<"projects">
}) {
  if (!flags.some((f) => f.kind === "missing-overage-rate")) return null
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>
        Over budget with no overage rate — set one to generate the invoice.{" "}
        <Link
          href={`/projects/${projectId}?tab=settings`}
          className="font-medium underline underline-offset-2"
        >
          Set rate
        </Link>
      </AlertDescription>
    </Alert>
  )
}
