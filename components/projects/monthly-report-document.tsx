"use client"

import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import { DocumentParties } from "@/components/document/parties"
import { DocumentPaymentSummary } from "@/components/document/payment-summary"
import { RetainerUsageTable } from "@/components/document/retainer-usage-table"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { formatCurrency, formatInvoiceNumber, formatMinutes } from "@/lib/format"
import { getRetainerUsageLabels } from "@/lib/retainerLabels"

type MonthlyReport = NonNullable<FunctionReturnType<typeof api.statements.getRetainerStatement>>

/**
 * Read-only Monthly Report document for a retainer period. Rendered both on
 * the project Reports page (download / print) and by the future auto-send
 * cron — `getRetainerStatement` is the single source of truth so the
 * emailed PDF and the manually downloaded one cannot drift apart.
 */
export function MonthlyReportDocument({ report }: { report: MonthlyReport }) {
  const {
    inProgress,
    period,
    retainerUsage,
    billing,
    project,
    client,
    brand,
    billableCategoryGroups,
    linkedInvoice,
  } = report

  const amountDue = retainerUsage.total.amountDue
  const hasPaymentDue = amountDue > 0
  const balanceIsNegative = retainerUsage.total.balanceMinutes < 0
  const resultLabel = retainerUsage.total.balanceMinutes >= 0
    ? "within budget"
    : project.rolloverEnabled
      ? "cycle over budget"
      : "over budget"

  const usageLabels = getRetainerUsageLabels({
    kind: retainerUsage.kind,
    closed: retainerUsage.closed,
    monthlyIncludedMinutes: retainerUsage.monthlyIncludedMinutes,
  })

  return (
    <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Monthly Report
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{period.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
        </div>

        <DocumentPaymentSummary
          amount={amountDue}
          currency={billing.currency}
          status={hasPaymentDue ? "Payment due" : "Report only"}
          tone={hasPaymentDue ? "due" : "success"}
        >
          {hasPaymentDue ? (
            linkedInvoice ? (
              <>
                Pay{" "}
                <span className="font-mono">
                  {formatInvoiceNumber(linkedInvoice.prefix, linkedInvoice.number)}
                </span>{" "}
                because this {project.rolloverEnabled ? "cycle" : "month"} closed over budget.
              </>
            ) : (
              <>This {project.rolloverEnabled ? "cycle" : "month"} closed over budget.</>
            )
          ) : balanceIsNegative ? (
            <>
              No payment needed yet. Payment is only due when this{" "}
              {project.rolloverEnabled ? "cycle" : "month"} closes over budget.
            </>
          ) : inProgress ? (
            <>No payment needed yet. This report contains partial data.</>
          ) : (
            <>No payment needed. This {project.rolloverEnabled ? "cycle" : "month"} finished within the included hours.</>
          )}
        </DocumentPaymentSummary>
      </div>

      <DocumentParties brand={brand} client={client} />

      <div className="flex flex-wrap items-center gap-6 border-y py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Period
          </p>
          <p className="mt-1 text-sm">
            {period.start} — {period.end}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {project.rolloverEnabled ? "Cycle result" : "Month result"}
          </p>
          <div className="mt-1">
            <ColoredPillBadge
              tone={retainerUsage.total.balanceMinutes >= 0 ? "green" : "amber"}
              label={resultLabel}
            />
          </div>
        </div>
        {project.rolloverEnabled && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cycle
            </p>
            <p className="mt-1 text-sm">{project.cycleLength}-month rollover</p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Payment rule
          </p>
          <p className="mt-1 text-sm">
            {project.rolloverEnabled ? "Only at cycle close" : "Monthly"}
          </p>
        </div>
      </div>

      {inProgress && (
        <ColoredPillBadge tone="neutral" label="In progress — partial data" />
      )}

      <RetainerUsageTable
        rows={retainerUsage.rows}
        total={retainerUsage.total}
        totalLabel={usageLabels.totalLabel}
        balanceLabel={usageLabels.balanceLabel}
        subtitle={usageLabels.subtitle}
        currency={billing.currency}
      />

      {billableCategoryGroups.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Work Breakdown</h2>
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Category / Task</th>
                <th className="px-3 py-2 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {billableCategoryGroups.map((cat) => (
                <CategorySection key={cat.categoryName} cat={cat} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(billing.monthlyFee > 0 || billing.overageAmount > 0) && (
        <section className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          {billing.monthlyFee > 0 && (
            <p>
              Monthly retainer fee ({formatCurrency(billing.monthlyFee, billing.currency)}/mo)
              is billed separately via Stripe.
            </p>
          )}
          {billing.overageAmount > 0 && (
            <p className={billing.monthlyFee > 0 ? "mt-2" : undefined}>
              Overage payment:{" "}
              <span className="text-foreground tabular-nums">
                {roundHours(retainerUsage.total.overageMinutes)}h ×{" "}
                {formatCurrency(billing.overageRate, billing.currency)}/h ={" "}
                {formatCurrency(billing.overageAmount, billing.currency)}
              </span>
              .
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

function CategorySection({
  cat,
}: {
  cat: MonthlyReport["billableCategoryGroups"][number]
}) {
  return (
    <>
      <tr className="border-t-[12px] border-t-transparent">
        <td className="bg-muted px-3 py-2">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-[0.08em]">
              {cat.categoryName}
            </span>
            <span className="text-xs text-muted-foreground">
              {cat.tasks.length} {cat.tasks.length === 1 ? "task" : "tasks"}
            </span>
          </div>
        </td>
        <td className="bg-muted px-3 py-2 text-right font-medium tabular-nums">
          {formatMinutes(cat.totalMinutes)}
        </td>
      </tr>
      {cat.tasks.map((task) => (
        <tr key={task.taskId}>
          <td className="border-b px-3 py-2.5 pl-5">
            {task.taskTitle}
          </td>
          <td className="border-b px-3 py-2.5 text-right tabular-nums">
            {formatMinutes(task.totalMinutes)}
          </td>
        </tr>
      ))}
    </>
  )
}
