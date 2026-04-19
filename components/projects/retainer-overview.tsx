"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { RetainerBalanceBadge } from "@/components/retainer-balance-badge"
import { CycleDots } from "@/components/cycle-dots"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { MonthTaskTable } from "./month-task-table"
import { ProjectSummaryCard } from "./summary/project-summary-card"
import { cn } from "@/lib/utils"
import { formatMinutes, formatCurrencyPrecise, formatInvoiceNumber } from "@/lib/format"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import {
  AlertTriangleIcon,
  ZapIcon,
  ReceiptIcon,
  ExternalLinkIcon,
} from "lucide-react"

export function RetainerOverview({
  projectId,
  projectName,
  currency: projectCurrency,
}: {
  projectId: Id<"projects">
  projectName: string
  currency: string
}) {
  const searchParams = useSearchParams()
  const cycleOffsetParam = Number(searchParams.get("cycleOffset") ?? "0")
  const cycleOffset = Number.isFinite(cycleOffsetParam) ? cycleOffsetParam : 0
  const [activeMonth, setActiveMonth] = useState<{ year: number; month: number } | null>(null)
  const handleTaskClick = useTaskDetailNav()
  const data = useQuery(api.projects.getRetainerData, { id: projectId, cycleOffset })

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <ProjectSummaryCard projectId={projectId} />
        <MonthlyBreakdownSkeleton />
      </div>
    )
  }

  if (data === null) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Retainer data not available. Check project configuration.
      </p>
    )
  }

  const {
    cycleLength,
    isCycleClosed,
    months,
    overageMinutes,
    overageDue,
    overageRate,
    rolloverEnabled,
    currency,
  } = data

  // Determine the default open accordion item (current month or last month of closed cycle)
  const defaultMonth = months.find((m) => !m.isMonthClosed) ?? months[months.length - 1]
  const defaultAccordionValue = defaultMonth
    ? `${defaultMonth.year}-${String(defaultMonth.month + 1).padStart(2, "0")}`
    : undefined

  // Cycle-closing month — target for overage and cycle-end banner CTAs
  const closingMonth = months[months.length - 1] ?? null
  const closingMonthInvoiced = closingMonth?.invoice != null
  const openClosingMonthModal = () => {
    if (!closingMonth || closingMonthInvoiced) return
    setActiveMonth({ year: closingMonth.year, month: closingMonth.month + 1 })
  }

  return (
    <div className="flex flex-col gap-6">
      <ProjectSummaryCard projectId={projectId} />

      {overageRate === 0 && overageMinutes > 0 && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Overage rate not set</AlertTitle>
          <AlertDescription>
            This retainer has {formatMinutes(overageMinutes)} over budget but no overage rate configured. Set an overage rate in project settings to calculate overage charges.
          </AlertDescription>
        </Alert>
      )}

      {isCycleClosed && overageDue > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Overage invoice — {formatCurrencyPrecise(overageDue, currency)} due</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {formatMinutes(overageMinutes)} over budget &middot; {formatCurrencyPrecise(overageDue, currency)} due
              {!rolloverEnabled && " · invoice each month below"}
            </span>
            {rolloverEnabled && (
              <BannerInvoiceButton
                invoiced={closingMonthInvoiced}
                monthLabel={closingMonth?.label ?? ""}
                onClick={openClosingMonthModal}
                className="ml-4"
              />
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible defaultValue={defaultAccordionValue}>
            {months.map((month) => {
              const monthKey = `${month.year}-${String(month.month + 1).padStart(2, "0")}`
              return (
                <AccordionItem key={monthKey} value={monthKey}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex w-full items-center gap-3 pr-2">
                      <span className="font-medium">{month.label}</span>
                      <CycleDots
                        current={month.cyclePosition}
                        total={cycleLength}
                        className="hidden sm:inline-flex"
                      />
                      <span className="ml-auto tabular-nums text-sm text-muted-foreground">
                        {formatMinutes(month.workedMinutes)} / {formatMinutes(month.available)}
                      </span>
                      <span className={cn(
                        "min-w-16 text-right tabular-nums text-sm font-medium",
                        month.endBalance < 0 && "text-destructive"
                      )}>
                        {formatMinutes(month.endBalance)}
                      </span>
                      <RetainerBalanceBadge status={month.balanceStatus} />
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-3 pl-1">
                      <div className="grid grid-cols-3 gap-4 rounded-md bg-muted/50 p-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">Start balance</span>
                          <p className="font-medium tabular-nums">{formatMinutes(month.startBalance)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Available</span>
                          <p className="font-medium tabular-nums">{formatMinutes(month.available)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Worked</span>
                          <p className="font-medium tabular-nums">{formatMinutes(month.workedMinutes)}</p>
                        </div>
                      </div>

                      {month.entryCount === 0 ? (
                        <p className="py-3 text-center text-sm text-muted-foreground">
                          No time entries for this month yet.
                        </p>
                      ) : (
                        <MonthTaskTable
                          billableCategoryGroups={month.billableCategoryGroups}
                          nonBillableCategoryGroups={month.nonBillableCategoryGroups}
                          onTaskClick={handleTaskClick}
                          ariaLabel={`Time entries for ${month.label}`}
                        />
                      )}

                      {/* Invoice control — closed months only */}
                      {month.isMonthClosed && (
                        <div className="flex items-center justify-end gap-2 border-t pt-3">
                          {month.invoice ? (
                            <>
                              <InvoiceStatusBadge status={month.invoice.status} />
                              <Button asChild size="sm" variant="ghost">
                                <Link href={`/invoices/${month.invoice.id}?from=project&projectId=${projectId}&tab=invoices`}>
                                  View {formatInvoiceNumber(month.invoice.prefix, month.invoice.number)}
                                  <ExternalLinkIcon />
                                </Link>
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveMonth({ year: month.year, month: month.month + 1 })}
                            >
                              <ReceiptIcon />
                              Invoice this month
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}

          </Accordion>
        </CardContent>
      </Card>

      {isCycleClosed && (
        <div>
          {overageMinutes > 0 ? (
            <Card size="sm" className="border-destructive/20 bg-destructive/5">
              <CardContent className="flex items-center gap-2">
                <ZapIcon className="text-destructive" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Extra hours invoice</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatMinutes(overageMinutes)} over budget @ {formatCurrencyPrecise(overageRate, currency)}/h = {formatCurrencyPrecise(overageDue, currency)}
                    {!rolloverEnabled && " · invoice each month below"}
                  </p>
                </div>
                {rolloverEnabled && (
                  <BannerInvoiceButton
                    invoiced={closingMonthInvoiced}
                    monthLabel={closingMonth?.label ?? ""}
                    onClick={openClosingMonthModal}
                  />
                )}
              </CardContent>
            </Card>
          ) : (
            <Card size="sm" className="bg-muted/50">
              <CardContent className="flex items-center gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {rolloverEnabled
                      ? "Unused hours forfeited at cycle end"
                      : "Unused hours forfeited — monthly settlement"
                    }
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatMinutes(Math.abs(months[months.length - 1]?.endBalance ?? 0))} remaining &middot; not carried to next cycle
                  </p>
                </div>
                <BannerInvoiceButton
                  invoiced={closingMonthInvoiced}
                  monthLabel={closingMonth?.label ?? ""}
                  onClick={openClosingMonthModal}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create Invoice modal — remount per month so prefill resets cleanly */}
      {activeMonth && (
        <CreateInvoiceModal
          key={`${projectId}-${activeMonth.year}-${activeMonth.month}`}
          open={true}
          onOpenChange={(next) => {
            if (!next) setActiveMonth(null)
          }}
          projectId={projectId}
          projectName={projectName}
          billingType="retainer"
          currency={projectCurrency}
          initialRetainerYear={activeMonth.year}
          initialRetainerMonth={activeMonth.month}
        />
      )}

    </div>
  )
}

function BannerInvoiceButton({
  invoiced,
  monthLabel,
  onClick,
  className,
}: {
  invoiced: boolean
  monthLabel: string
  onClick: () => void
  className?: string
}) {
  if (invoiced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("shrink-0", className)}>
            <Button size="sm" variant="outline" disabled>
              Create Invoice
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {monthLabel ? `${monthLabel} is already invoiced` : "Already invoiced"}
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button size="sm" variant="outline" onClick={onClick} className={cn("shrink-0", className)}>
      Create Invoice
    </Button>
  )
}

function MonthlyBreakdownSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between border-b py-3 last:border-0">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-8" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
