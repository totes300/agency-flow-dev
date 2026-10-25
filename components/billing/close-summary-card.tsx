"use client"

import Link from "next/link"
import { useAction } from "convex/react"
import {
  CheckIcon,
  CircleAlertIcon,
  FileTextIcon,
  ReceiptIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import { PERIOD_STATE_COPY } from "@/convex/lib/billing/periodState"
import type { PeriodRow } from "@/convex/lib/billing/projectPeriods"
import {
  PeriodActionButton,
  closeWorkspaceHref,
  invoiceHref,
  monthlyReportHref,
  setRateHref,
  usePeriodActions,
} from "@/components/billing/period-actions"
import type { Id } from "@/convex/_generated/dataModel"
import { WorksheetDownloadButton } from "@/components/worksheet/worksheet-download-button"
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
  closeFlagLabel,
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
    ? (data.periodRow ? PERIOD_STATE_COPY[data.periodRow.state].chip : "Closed")
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
      {data.isClosed && data.periodRow ? <ClosedFooter data={data} row={data.periodRow} /> : null}
    </Card>
  )
}

/**
 * A closed period (§10): its one action, its documents and the state's undo
 * — instead of a bare "Closed" card. The same handlers as the project page.
 */
function ClosedFooter({ data, row }: { data: CloseWorkspaceData; row: PeriodRow }) {
  const projectId = data.project.id
  const from = closeWorkspaceHref(projectId, row.key)
  const actions = usePeriodActions(from)
  const exportClose = useAction(api.worksheets.exportClose)
  const closeId = row.closeId
  const target = { row, invoice: row.invoice, projectId }
  return (
    <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
      {row.action ? (
        <PeriodActionButton action={row.action} size="default" className="w-full" onRun={() => actions.primary(target, row.action!)} />
      ) : null}
      <div className="flex flex-col gap-1">
        {row.invoice ? (
          <Button variant="ghost" size="sm" className="justify-start" asChild>
            <Link href={invoiceHref(row.invoice.id, from)}>
              <ReceiptIcon data-icon="inline-start" />
              Invoice {row.invoice.number ?? "(draft)"}
            </Link>
          </Button>
        ) : null}
        {row.documents.monthlyReport ? (
          <Button variant="ghost" size="sm" className="justify-start" asChild>
            <Link href={monthlyReportHref(projectId, row, row.end)}>
              <FileTextIcon data-icon="inline-start" />
              Monthly report
            </Link>
          </Button>
        ) : null}
        {closeId ? (
          <WorksheetDownloadButton
            variant="ghost"
            className="justify-start"
            label="Worksheet"
            run={() => exportClose({ closeId })}
          />
        ) : null}
      </div>
      {row.undo.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          {row.undo.map((item) => (
            <Button
              key={item.kind}
              variant="outline"
              size="sm"
              disabled={item.disabledReason !== undefined}
              title={item.disabledReason}
              onClick={() => actions.undo(target, item)}
            >
              {item.disabledReason ?? item.label}
            </Button>
          ))}
        </div>
      ) : null}
      {actions.dialogs}
    </CardFooter>
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
        {closeFlagLabel(summary)}
      </span>
      {summary.kind === "missing-overage-rate" ? (
        <Button variant="link" size="sm" className="h-auto shrink-0 p-0" asChild>
          <Link href={setRateHref(projectId as Id<"projects">)}>Set rate</Link>
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
