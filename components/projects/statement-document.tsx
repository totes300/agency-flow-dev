"use client"

import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import { InvoiceParties } from "@/components/invoices/invoice-parties"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { formatCurrency, formatMinutes } from "@/lib/format"

type Statement = NonNullable<FunctionReturnType<typeof api.statements.getRetainerStatement>>

/**
 * Read-only "Activity Statement" document for a retainer period.
 *
 * Deliberately NOT shaped like an invoice — no invoice number, no AMOUNT
 * DUE block, no due date. The header reads "Activity Statement" so a client
 * receiving the PDF can't mistake it for a bill. When there IS a real
 * invoice for the same period (overage or fee was charged), the doc surfaces
 * a small "Invoice → INV-XXX" pointer near the top-right meta block.
 *
 * Rendered identically by:
 *   - the project Statements page (download / print / save-as-PDF via
 *     browser-native print dialog)
 *   - the future auto-send cron (HTML → PDF for the email attachment)
 *
 * Single source of truth = `getRetainerStatement` query. No drift possible
 * between "what I downloaded" and "what was emailed."
 */
export function StatementDocument({ statement }: { statement: Statement }) {
  const { period, balance, billing, project, client, brand, billableCategoryGroups, linkedInvoice } = statement

  const withinBudget = balance.endBalanceMinutes >= 0
  const totalBilled = billing.total > 0

  return (
    <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 md:p-8">
      {/* Header — clearly a "Statement", not an invoice */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Activity Statement
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{period.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
        </div>
        {linkedInvoice && (
          <div className="text-right text-xs text-muted-foreground">
            Billed via{" "}
            <span className="font-mono text-foreground">
              {linkedInvoice.prefix}
              {String(linkedInvoice.number).padStart(4, "0")}
            </span>
          </div>
        )}
      </div>

      {/* FROM / TO — same parties block invoices use, so the brand identity
          is consistent across both document types */}
      <InvoiceParties brand={brand} client={client} />

      {/* Period meta + status pill */}
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
            Status
          </p>
          <div className="mt-1">
            <ColoredPillBadge
              tone={withinBudget ? "green" : "amber"}
              label={withinBudget ? "within budget" : "over budget"}
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
      </div>

      {/* Balance breakdown — the substantive content */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Time Summary</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm tabular-nums">
          <span className="text-muted-foreground">Carried over from last period</span>
          <span className="text-right">{formatMinutes(balance.startBalanceMinutes)}</span>

          <span className="text-muted-foreground">Included this period</span>
          <span className="text-right">{formatMinutes(balance.includedMinutes)}</span>

          <span className="text-muted-foreground">Hours used</span>
          <span className="text-right">−{formatMinutes(balance.usedMinutes)}</span>

          <span className="border-t pt-2 font-medium">
            {withinBudget ? "Remaining" : "Over budget"}
          </span>
          <span
            className={`border-t pt-2 text-right font-medium ${
              withinBudget ? "text-foreground" : "text-amber-700 dark:text-amber-400"
            }`}
          >
            {withinBudget
              ? formatMinutes(balance.endBalanceMinutes)
              : `−${formatMinutes(balance.overageMinutes)}`}
          </span>
        </div>
      </section>

      {/* Per-category time breakdown — what work was actually done */}
      {billableCategoryGroups.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Work Breakdown</h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Category / Task</th>
                  <th className="px-3 py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {billableCategoryGroups.map((cat) => (
                  <CategorySection key={cat.categoryName} cat={cat} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Billing summary — only renders if there's something to bill. For
          $0 statements the row is omitted entirely so the document stays
          clearly informational. */}
      {totalBilled ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Billing Summary</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm tabular-nums">
            {billing.monthlyFee > 0 && (
              <>
                <span className="text-muted-foreground">Retainer fee</span>
                <span className="text-right">
                  {formatCurrency(billing.monthlyFee, billing.currency)}
                </span>
              </>
            )}
            {billing.overageAmount > 0 && (
              <>
                <span className="text-muted-foreground">
                  Overage ({balance.overageHours}h × {formatCurrency(billing.overageRate, billing.currency)}/h)
                </span>
                <span className="text-right">
                  {formatCurrency(billing.overageAmount, billing.currency)}
                </span>
              </>
            )}
            <span className="border-t pt-2 font-semibold">Total billed</span>
            <span className="border-t pt-2 text-right font-semibold">
              {formatCurrency(billing.total, billing.currency)}
            </span>
          </div>
          {linkedInvoice && (
            <p className="mt-3 text-xs text-muted-foreground">
              See invoice {linkedInvoice.prefix}
              {String(linkedInvoice.number).padStart(4, "0")} for payment details.
            </p>
          )}
        </section>
      ) : (
        <section className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          No charges this period — {project.name} is within the included
          retainer budget.
        </section>
      )}
    </div>
  )
}

function CategorySection({
  cat,
}: {
  cat: Statement["billableCategoryGroups"][number]
}) {
  return (
    <>
      <tr className="bg-muted/20">
        <td className="px-3 py-2">
          <span className="font-medium">{cat.categoryName}</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {formatMinutes(cat.totalMinutes)}
        </td>
      </tr>
      {cat.tasks.map((task) => (
        <tr key={task.taskId}>
          <td className="px-3 py-2 pl-8 text-muted-foreground">{task.taskTitle}</td>
          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
            {formatMinutes(task.totalMinutes)}
          </td>
        </tr>
      ))}
    </>
  )
}
