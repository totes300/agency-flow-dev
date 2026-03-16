"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Skeleton } from "@/components/ui/skeleton"
import { MetricCard } from "@/components/metric-card"
import { BudgetProgress } from "@/components/budget-progress"
import { RetainerBalanceBadge } from "@/components/retainer-balance-badge"
import { CycleDots } from "@/components/cycle-dots"
import { cn } from "@/lib/utils"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  ZapIcon,
} from "lucide-react"

export function RetainerOverview({ projectId }: { projectId: Id<"projects"> }) {
  const [cycleOffset, setCycleOffset] = useState(0)
  const data = useQuery(api.projects.getRetainerData, { id: projectId, cycleOffset })

  if (data === undefined) {
    return <RetainerOverviewSkeleton />
  }

  if (data === null) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Retainer data not available. Check project configuration.
      </p>
    )
  }

  const {
    cycleNumber,
    cycleStart,
    cycleEnd,
    cycleLength,
    isCycleClosed,
    hasPreviousCycle,
    hasNextCycle,
    months,
    cycleBudget,
    cycleWorked,
    utilization,
    overageMinutes,
    overageDue,
    overageRate,
    rolloverEnabled,
    currency,
  } = data

  // Format cycle date range for display
  const startLabel = new Date(cycleStart + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
  const endLabel = new Date(cycleEnd + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
  const cycleLabel = startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`

  // Determine the default open accordion item (current month or last month of closed cycle)
  const defaultMonth = months.find((m) => !m.isMonthClosed) ?? months[months.length - 1]
  const defaultAccordionValue = defaultMonth
    ? `${defaultMonth.year}-${String(defaultMonth.month + 1).padStart(2, "0")}`
    : undefined

  return (
    <div className="space-y-6">
      {/* Cycle Overview Card */}
      <Card>
        <CardHeader>
          <CardTitle>Cycle Overview</CardTitle>
          <CardDescription>
            {cycleLabel} &middot; {cycleLength}-month {rolloverEnabled ? "rollover" : "monthly"}
            {isCycleClosed && " (closed)"}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCycleOffset((prev) => prev - 1)}
                disabled={!hasPreviousCycle}
                aria-label="Previous cycle"
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <span className="min-w-[60px] text-center text-xs text-muted-foreground tabular-nums">
                Cycle {cycleNumber}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCycleOffset((prev) => prev + 1)}
                disabled={!hasNextCycle}
                aria-label="Next cycle"
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Progress Bar */}
          <div className="space-y-2">
            <BudgetProgress used={cycleWorked} budget={cycleBudget} />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{formatMinutes(cycleBudget)} budget</span>
              {overageMinutes > 0 && (
                <span className="text-destructive">+{formatMinutes(overageMinutes)} over</span>
              )}
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              label="Hours Used"
              value={formatMinutes(cycleWorked)}
              detail={`of ${formatMinutes(cycleBudget)}`}
            />
            <MetricCard
              label="Over Budget"
              value={overageMinutes > 0 ? `+${formatMinutes(overageMinutes)}` : "—"}
              detail={`${Math.round(utilization)}% utilization`}
              variant={overageMinutes > 0 ? "destructive" : "default"}
            />
            <MetricCard
              label="Overage Due"
              value={overageDue > 0 ? formatCurrencyPrecise(overageDue, currency) : "—"}
              detail={overageDue > 0
                ? `${formatMinutes(overageMinutes)} × ${formatCurrencyPrecise(overageRate, currency)}/h`
                : "No overage"
              }
              variant={overageDue > 0 ? "warning" : "default"}
            />
          </div>
        </CardContent>

        <CardFooter className="text-xs text-muted-foreground tabular-nums">
          {cycleLength} {cycleLength === 1 ? "month" : "months"} &middot; {formatMinutes(cycleBudget)} budget &middot; {formatMinutes(cycleWorked)} used
        </CardFooter>
      </Card>

      {/* Overage Invoice Banner */}
      {isCycleClosed && overageDue > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Overage invoice — {formatCurrencyPrecise(overageDue, currency)} due</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {formatMinutes(overageMinutes)} over budget at {formatCurrencyPrecise(overageRate, currency)}/h
            </span>
            <Button size="sm" variant="outline" disabled className="ml-4 shrink-0">
              Create Invoice
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Monthly Breakdown */}
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
                    <div className="space-y-3 pl-1">
                      {/* Balance details */}
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

                      {/* Time entries placeholder */}
                      {month.entryCount === 0 ? (
                        <p className="py-3 text-center text-sm text-muted-foreground">
                          No time entries for this month yet.
                        </p>
                      ) : (
                        <div className="text-sm">
                          {/* Phase 7: render grouped entries here */}
                          <p className="py-2 text-muted-foreground">
                            {month.entryCount} entries &middot; {month.taskCount} tasks &middot; Total: {formatMinutes(month.workedMinutes)}
                          </p>
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

      {/* Cycle-end settlement */}
      {isCycleClosed && (
        <div>
          {overageMinutes > 0 ? (
            <Card size="sm" className="border-destructive/20 bg-destructive/5">
              <CardContent className="flex items-center gap-2">
                <ZapIcon className="size-4 text-destructive" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Extra hours invoice</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatMinutes(overageMinutes)} × {formatCurrencyPrecise(overageRate, currency)}/h = {formatCurrencyPrecise(overageDue, currency)}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled className="shrink-0">
                  Create Invoice
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card size="sm" className="bg-muted/50">
              <CardContent>
                <p className="text-sm font-medium">
                  {rolloverEnabled
                    ? "Unused hours forfeited at cycle end"
                    : "Unused hours forfeited — monthly settlement"
                  }
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatMinutes(Math.abs(months[months.length - 1]?.endBalance ?? 0))} remaining &middot; not carried to next cycle
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

    </div>
  )
}

function RetainerOverviewSkeleton() {
  return (
    <div className="space-y-6">
      {/* Cycle Overview card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-56" />
            </div>
            {/* Cycle navigator */}
            <div className="flex items-center gap-1">
              <Skeleton className="size-7 rounded-md" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="size-7 rounded-md" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <Skeleton className="h-2.5 w-full rounded-full" />
            <div className="flex justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          {/* 3 metric cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-xl p-4 ring-1 ring-foreground/10">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Skeleton className="h-3.5 w-48" />
        </CardFooter>
      </Card>

      {/* Monthly Breakdown card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Accordion rows */}
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
    </div>
  )
}
