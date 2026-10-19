"use client"

import Link from "next/link"
import {
  CheckIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { CloseCommitButton } from "@/components/billing/close-commit-button"
import {
  summarizeCloseFlags,
  type CloseFlagKind,
  type CloseFlagSummary,
} from "@/convex/lib/closeFlags"
import { formatCurrency, formatHoursShort } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseWorkspaceData } from "@/convex/billingViews"

/**
 * The Close workspace's decision panel, Stripe "invoice preview" style: the
 * amount the close bills, the few lines that explain it, the one primary
 * action, and what to check before committing. Every number is the server's;
 * this component only formats.
 */
export function CloseSummaryCard({
  data,
  activeIssue,
  onToggleIssue,
}: {
  data: CloseWorkspaceData
  activeIssue: CloseFlagKind | null
  onToggleIssue: (kind: CloseFlagKind) => void
}) {
  const isRetainer = data.billingType === "retainer"
  const noCharge = isRetainer && data.withinBudget
  const title = data.isClosed
    ? "Closed"
    : noCharge
      ? "Nothing to invoice"
      : "Invoice preview"

  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>
          <span className="text-3xl font-semibold tabular-nums tracking-tight">
            {noCharge ? "No charge" : formatCurrency(data.amount, data.currency)}
          </span>
        </CardTitle>
        {noCharge && !data.isClosed && (
          <p className="text-xs text-muted-foreground">
            Closing settles the time and creates the monthly report.
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-2 text-sm">
        {isRetainer ? (
          <>
            <Line label="Included" value={formatHoursShort(data.includedMinutes)} />
            <Line label="Logged" value={formatHoursShort(data.usageMinutes)} />
            {data.overageMinutes > 0 && (
              <Line
                label="Overage"
                value={
                  data.overageRate != null
                    ? `${formatHoursShort(data.overageMinutes)} × ${formatCurrency(data.overageRate, data.currency)}`
                    : formatHoursShort(data.overageMinutes)
                }
              />
            )}
          </>
        ) : (
          <Line label="Billable time" value={formatHoursShort(data.usageMinutes)} />
        )}
        {!noCharge && (
          <>
            <Separator className="my-1" />
            <Line label="Total" value={formatCurrency(data.amount, data.currency)} strong />
          </>
        )}
      </CardContent>

      {!data.isClosed && (
        <CardFooter className="flex flex-col items-stretch gap-4 border-t pt-4">
          <CloseCommitButton data={data} />
          <Checks data={data} activeIssue={activeIssue} onToggleIssue={onToggleIssue} />
        </CardFooter>
      )}
      {data.isClosed && data.coveringDraft && (
        <CardFooter className="border-t pt-4">
          <Button variant="outline" className="w-full" asChild>
            <Link href={`/invoices/${data.coveringDraft.id}`}>Open draft invoice</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={cn("tabular-nums", strong && "font-medium")}>{value}</span>
    </div>
  )
}

/** "Before you close" — the review flags as a short list; entry-backed ones filter the ledger. */
function Checks({
  data,
  activeIssue,
  onToggleIssue,
}: {
  data: CloseWorkspaceData
  activeIssue: CloseFlagKind | null
  onToggleIssue: (kind: CloseFlagKind) => void
}) {
  const summaries = summarizeCloseFlags(data.flags).filter((s) => s.kind !== "carried-in")
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Before you close</p>
      {summaries.length === 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <CheckIcon aria-hidden className="size-4 text-emerald-600 dark:text-emerald-500" />
          Everything looks ready
        </p>
      ) : (
        summaries.map((summary) => (
          <CheckRow
            key={summary.kind}
            summary={summary}
            projectId={data.project.id}
            active={activeIssue === summary.kind}
            onToggle={() => onToggleIssue(summary.kind)}
          />
        ))
      )}
    </div>
  )
}

function CheckRow({
  summary,
  projectId,
  active,
  onToggle,
}: {
  summary: CloseFlagSummary
  projectId: string
  active: boolean
  onToggle: () => void
}) {
  const blocking = summary.severity === "blocking"
  const Icon = blocking ? CircleAlertIcon : TriangleAlertIcon
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            blocking ? "text-destructive" : "text-amber-600 dark:text-amber-500",
          )}
        />
        {checkLabel(summary)}
      </span>
      {summary.kind === "missing-overage-rate" ? (
        <Button variant="link" size="sm" className="h-auto shrink-0 p-0" asChild>
          <Link href={`/projects/${projectId}?tab=settings`}>Set rate</Link>
        </Button>
      ) : summary.entryIds.length > 0 ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto shrink-0 p-0"
          aria-pressed={active}
          onClick={onToggle}
        >
          {active ? "Show all" : "Show"}
        </Button>
      ) : null}
    </div>
  )
}

function checkLabel(summary: CloseFlagSummary): string {
  const n = summary.count
  switch (summary.kind) {
    case "missing-overage-rate":
      return "Over budget, but the project has no overage rate"
    case "running-timer":
      return n === 1 ? "A timer is still running" : `${n} timers are still running`
    case "long-entry":
      return n === 1 ? "1 entry is over 8h" : `${n} entries are over 8h`
    case "missing-note":
      return n === 1 ? "1 entry has no note" : `${n} entries have no note`
    case "carried-in":
      return n === 1 ? "1 entry carried in" : `${n} entries carried in`
  }
}
