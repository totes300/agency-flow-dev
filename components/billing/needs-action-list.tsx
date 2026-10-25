"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, ClockIcon, CoinsIcon, FileTextIcon, ReceiptIcon } from "lucide-react"
import type { NeedsActionGroup, NeedsActionRow } from "@/convex/billingViews"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { GroupHeaderRow } from "@/components/task-view/group-header"
import { PeriodDetailSheet } from "@/components/projects/period-detail-sheet"
import { shortDate } from "@/components/projects/overview/period-card"
import { PeriodActionButton, PeriodMenu, usePeriodActions } from "@/components/billing/period-actions"
import { formatMinor, formatMinutes } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Group copy and icon, in month-end order (§8 step 4). */
export const NEEDS_ACTION_GROUP_COPY: Record<NeedsActionGroup, { name: string; hint: string; icon: ReactNode }> = {
  needs_rate: {
    name: "Needs rate",
    hint: "Set the overage rate before this period can be billed.",
    icon: <CoinsIcon className="size-4 text-amber-600" />,
  },
  ready_to_invoice: {
    name: "Ready to invoice",
    hint: "Ended periods with billable work. Review creates the draft invoice.",
    icon: <ReceiptIcon className="size-4 text-blue-600" />,
  },
  ready_to_close: {
    name: "Ready to close",
    hint: "Ended, within budget. Closing freezes the month and its report.",
    icon: <CheckIcon className="size-4 text-blue-600" />,
  },
  draft: {
    name: "Drafts",
    hint: "Draft invoices waiting to be finalized.",
    icon: <FileTextIcon className="size-4 text-amber-600" />,
  },
  past_due: {
    name: "Past due",
    hint: "Invoiced, past the due date.",
    icon: <ClockIcon className="size-4 text-destructive" />,
  },
}

const TYPE_LABEL = { retainer: "Retainer", t_and_m: "T&M", fixed: "Fixed fee", non_billable: "Non-billable" } as const
const COLS = "grid-cols-[104px_minmax(180px,1.4fr)_minmax(120px,1fr)_120px_100px_150px_28px]"

/**
 * Billing hub → Needs action (§8 step 4): one row per period that needs
 * action, grouped Needs rate → Ready to invoice → Ready to close → Drafts →
 * Past due. Blocked periods stay listed — muted, their action disabled with
 * the reason. A row opens its project on that period.
 */
export function NeedsActionList({
  rows,
  todayStr,
  onViewInvoices,
  filtered,
  grouped = true,
}: {
  rows: NeedsActionRow[]
  todayStr: string
  onViewInvoices: () => void
  filtered: boolean
  /** Display → Grouping: by state (default) or one flat list in the same order. */
  grouped?: boolean
}) {
  const router = useRouter()
  const actions = usePeriodActions("/billing?view=action")
  const [collapsed, setCollapsed] = useState<ReadonlySet<NeedsActionGroup>>(new Set())
  const [entriesFor, setEntriesFor] = useState<NeedsActionRow | null>(null)

  if (rows.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{filtered ? "Nothing matches these filters" : "All caught up"}</EmptyTitle>
          <EmptyDescription>
            {filtered ? "Clear a filter to see more periods." : "No period needs action right now."}
          </EmptyDescription>
        </EmptyHeader>
        {filtered ? null : (
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={onViewInvoices}>
              View invoices
            </Button>
          </EmptyContent>
        )}
      </Empty>
    )
  }

  const groups = (Object.keys(NEEDS_ACTION_GROUP_COPY) as NeedsActionGroup[])
    .map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) }))
    .filter((g) => g.rows.length > 0)

  return (
    <div className="overflow-x-auto" role="table">
      <div role="row" className={cn("grid h-[34px] items-center gap-x-3 border-b border-border/60 px-3 text-xs text-muted-foreground", COLS)}>
        <span>Period</span>
        <span>Project</span>
        <span>Client</span>
        <span>Hours</span>
        <span>Amount</span>
        <span />
        <span />
      </div>
      {groups.map(({ group, rows: groupRows }) => {
        const copy = NEEDS_ACTION_GROUP_COPY[group]
        const isCollapsed = collapsed.has(group)
        return (
          <div key={group}>
            {grouped ? (
            <GroupHeaderRow
              label={copy.name}
              count={groupRows.length}
              icon={copy.icon}
              note={copy.hint}
              collapsed={isCollapsed}
              onToggle={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (!next.delete(group)) next.add(group)
                  return next
                })
              }
            />
            ) : null}
            {isCollapsed && grouped
              ? null
              : groupRows.map((row) => {
                  const blocked = Boolean(row.action?.blocked)
                  const period = row.period
                  const target = { row: period, invoice: row.invoice, projectId: row.projectId }
                  return (
                    <div
                      key={row.key}
                      role="row"
                      tabIndex={0}
                      onClick={() => router.push(`/projects/${row.projectId}${period ? `?period=${period.key}` : ""}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") router.push(`/projects/${row.projectId}${period ? `?period=${period.key}` : ""}`)
                      }}
                      className={cn(
                        "group/row grid min-h-[52px] cursor-pointer items-center gap-x-3 border-b border-border/60 px-3 py-1.5 text-sm hover:bg-muted/50",
                        COLS,
                      )}
                    >
                      <span className={cn("truncate font-medium", blocked && "text-muted-foreground")}>
                        {period ? shortPeriod(period) : "Fixed fee"}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className={cn("truncate font-medium", blocked && "text-muted-foreground")}>{row.projectName}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {TYPE_LABEL[row.billingType]} · {reasonLine(row, todayStr)}
                        </span>
                      </span>
                      <span className="truncate text-muted-foreground">{row.clientName}</span>
                      <span className={cn("font-mono text-xs", blocked ? "text-muted-foreground" : "text-muted-foreground")}>
                        {period ? (
                          <>
                            <span className={cn(period.includedMinutes !== null && period.usageMinutes > period.includedMinutes && !blocked && "text-destructive")}>
                              {formatMinutes(period.usageMinutes)}
                            </span>
                            {period.includedMinutes !== null ? ` / ${formatMinutes(period.includedMinutes)}` : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                      <span className={cn("font-mono text-xs", blocked ? "text-muted-foreground" : "text-foreground")}>
                        {row.group === "needs_rate" ? "—" : formatMinor(row.amountMinor, row.currency)}
                      </span>
                      <span className="flex flex-col items-start gap-0.5">
                        {row.action ? (
                          <PeriodActionButton
                            action={row.action}
                            className="h-[26px] px-2.5 text-xs"
                            onRun={() => actions.primary(target, row.action!)}
                          />
                        ) : null}
                        {row.action?.blocked ? (
                          <span className="text-[11px] text-muted-foreground">{row.action.blocked.reason}</span>
                        ) : null}
                      </span>
                      <span>
                        <PeriodMenu
                          projectId={row.projectId}
                          row={period ?? undefined}
                          undoItems={row.undo}
                          onViewEntries={() => setEntriesFor(row)}
                          onUndo={(item) => actions.undo(target, item)}
                          triggerClassName="size-6 opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100"
                        />
                      </span>
                    </div>
                  )
                })}
          </div>
        )
      })}
      {entriesFor?.period ? (
        <PeriodDetailSheet
          open
          onOpenChange={(open) => {
            if (!open) setEntriesFor(null)
          }}
          projectId={entriesFor.projectId}
          periodStart={entriesFor.period.start}
          periodEnd={entriesFor.period.end}
          periodLabel={entriesFor.period.label}
          currency={entriesFor.currency}
        />
      ) : null}
      {actions.dialogs}
    </div>
  )
}

/** "Sep 2026" for a month; the cycle label ("Aug – Oct 2026") for a cycle. */
export function shortPeriod(p: { start: string; end: string; label: string }): string {
  if (p.start.slice(0, 7) !== p.end.slice(0, 7)) return p.label
  const [y, m] = p.start.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

/** The row's sub-line reason (mockup): over / billable / within budget / invoice and due. */
function reasonLine(row: NeedsActionRow, todayStr: string): string {
  const p = row.period
  const inv = row.invoice
  switch (row.group) {
    case "needs_rate":
      return `+${formatMinutes(p?.overageMinutes ?? 0)} over · no overage rate`
    case "ready_to_invoice":
      return row.billingType === "t_and_m"
        ? `${formatMinutes(p?.usageMinutes ?? 0)} billable`
        : `+${formatMinutes(p?.overageMinutes ?? 0)} over`
    case "ready_to_close":
      return row.billingType === "t_and_m" ? "Nothing billable" : "Within budget"
    case "draft":
      return `${inv?.number ?? "Draft invoice"}${inv ? ` · created ${shortDate(inv.issueDate)}` : ""}`
    case "past_due": {
      const due = inv?.dueDate ?? todayStr
      const days = Math.max(1, Math.round((Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000))
      return `${inv?.number ?? "Invoice"} · due ${shortDate(due)} · ${days} days overdue`
    }
  }
}
