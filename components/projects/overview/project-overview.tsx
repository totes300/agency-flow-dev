"use client"

import { Suspense, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { ConvexError } from "convex/values"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProjectBillingPeriods } from "@/convex/lib/billing/projectPeriods"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { TaskView } from "@/components/task-view/task-view"
import { TaskTableSkeleton } from "@/components/task-view/task-view-skeleton"
import { PeriodDetailSheet } from "@/components/projects/period-detail-sheet"
import { PeriodMenu, invoiceHref, usePeriodActions } from "@/components/billing/period-actions"
import { FinanceCard } from "@/components/projects/overview/finance-card"
import { PeriodHeader, PeriodTrend } from "@/components/projects/overview/period-header"
import { FixedFeeCard, PeriodCard } from "@/components/projects/overview/period-card"
import { trendWindow, type SelectedPeriod } from "@/lib/billing/period-selection"
import { toastError } from "@/lib/toast-helpers"

/**
 * The project Overview (docs/prd-project-billing-redesign.md §7.2): the
 * selected period is the axis — header + trend, the finance card, and the
 * period's work. Fixed fee reads "Project to date" with no period.
 */
export function ProjectOverviewMain({
  projectId,
  projectName,
  billingType,
  model,
  selected,
  firstMonthKey,
  onSelect,
  onLogTime,
}: {
  projectId: Id<"projects">
  projectName: string
  billingType: "fixed" | "retainer" | "t_and_m" | "non_billable"
  model: ProjectBillingPeriods | null
  selected: SelectedPeriod
  firstMonthKey: string
  onSelect: (key: string) => void
  onLogTime: () => void
}) {
  const from = `/projects/${projectId}?period=${selected.key}`
  const actions = usePeriodActions(from)
  const [entriesOpen, setEntriesOpen] = useState(false)
  const fixed = billingType === "fixed"
  const cycleMonths = selected.row?.months.length ?? 1
  const row = selected.row ?? {
    key: selected.key,
    start: selected.start,
    end: selected.end,
    label: selected.label,
    closeId: null,
  }
  // "October" for a month, "Feb – Apr" for a rollover cycle.
  const month = selected.label.replace(/ \d{4}$/, "")

  return (
    <div className="flex flex-col gap-4">
      {fixed ? (
        <div className="pt-1">
          <h2 className="text-2xl leading-tight font-semibold tracking-tight">Project to date</h2>
          <p className="mt-1 text-sm text-muted-foreground">Fixed fee · all time logged on this project</p>
        </div>
      ) : (
        <PeriodHeader
          selected={selected}
          todayStr={model?.timezoneToday ?? selected.end}
          cycleMonths={cycleMonths}
          onSelect={onSelect}
          menu={
            <PeriodMenu
              projectId={projectId}
              row={row}
              undoItems={selected.row?.undo ?? []}
              onViewEntries={() => setEntriesOpen(true)}
              onUndo={(item) =>
                actions.undo({ row: selected.row, invoice: selected.row?.invoice ?? null, projectId }, item)
              }
              align="start"
            />
          }
          trend={
            billingType === "non_billable" || !model ? null : (
              <PeriodTrend
                bars={trendWindow(selected, model.periods, firstMonthKey)}
                selectedKey={selected.key}
                includedMinutes={billingType === "retainer" ? model.terms.includedMinutesPerMonth : null}
                onSelect={onSelect}
              />
            )
          }
        />
      )}

      {model ? <FinanceCard projectId={projectId} periodKey={selected.key} model={model} /> : null}

      <div className="mt-4 -mx-1">
        <Suspense fallback={<TaskTableSkeleton rows={4} />}>
          <TaskView
            surface="project"
            projectId={projectId}
            fromLabel={projectName}
            embedded
            workTitle={fixed ? "Work" : `Work in ${month}`}
            workedIn={fixed ? null : { from: selected.start, to: selected.end }}
            workEmpty={
              <Empty className="py-10">
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-normal text-muted-foreground">
                    {fixed ? "No active tasks." : `No time logged in ${month}.`}
                  </EmptyTitle>
                </EmptyHeader>
                {selected.isCurrent && !fixed ? (
                  <EmptyContent>
                    <Button variant="outline" size="sm" onClick={onLogTime}>
                      Log time
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            }
          />
        </Suspense>
      </div>

      <PeriodDetailSheet
        open={entriesOpen}
        onOpenChange={setEntriesOpen}
        projectId={projectId}
        periodStart={selected.start}
        periodEnd={selected.end}
        periodLabel={selected.label}
        currency={model?.currency ?? "USD"}
      />
      {actions.dialogs}
    </div>
  )
}

/** The side panel's billing card: the period card, or the fixed-fee card. */
export function ProjectBillingCard({
  projectId,
  model,
  selected,
  onSelect,
}: {
  projectId: Id<"projects">
  model: ProjectBillingPeriods
  selected: SelectedPeriod
  onSelect: (key: string) => void
}) {
  const router = useRouter()
  const from = `/projects/${projectId}?period=${selected.key}`
  const actions = usePeriodActions(from)
  const createFixedInvoice = useMutation(api.billingInvoices.createFixedInvoice)
  const [creating, setCreating] = useState(false)

  if (model.billingType === "fixed") {
    return (
      <FixedFeeCard
        model={model}
        from={`/projects/${projectId}`}
        creating={creating}
        onCreate={async () => {
          setCreating(true)
          try {
            const { invoiceId } = await createFixedInvoice({ projectId })
            router.push(invoiceHref(invoiceId, `/projects/${projectId}`))
          } catch (err) {
            // A5: a draft already exists — open it instead of drafting twice.
            const data = err instanceof ConvexError ? (err.data as { code?: string; invoiceId?: Id<"invoices"> }) : null
            if (data?.code === "DRAFT_EXISTS" && data.invoiceId) router.push(invoiceHref(data.invoiceId, `/projects/${projectId}`))
            else toastError(err, "Failed to create the invoice")
          } finally {
            setCreating(false)
          }
        }}
      />
    )
  }
  if (model.billingType === "non_billable") return null
  return (
    <>
      <PeriodCard projectId={projectId} model={model} selected={selected} actions={actions} from={from} onSelect={onSelect} />
      {actions.dialogs}
    </>
  )
}
