"use client"

import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { HealthBadge, getHealthStatus } from "@/components/health-badge"
import { CategoryBadge } from "@/components/category-badge"
import { BudgetProgress } from "@/components/budget-progress"
import { InfoIcon } from "lucide-react"
import { formatCurrency } from "@/lib/format"

export function FixedOverview({
  projectId,
  currency,
}: {
  projectId: Id<"projects">
  currency: string
}) {
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })

  const totals = useMemo(() => {
    if (!estimates) return { estimatedMinutes: 0, estCost: 0, estRevenue: 0 }
    return estimates.reduce(
      (acc, e) => ({
        estimatedMinutes: acc.estimatedMinutes + e.estimatedMinutes,
        estCost: acc.estCost + (e.estimatedMinutes / 60) * (e.internalCostRate ?? 0),
        estRevenue: acc.estRevenue + (e.estimatedMinutes / 60) * (e.clientBillingRate ?? 0),
      }),
      { estimatedMinutes: 0, estCost: 0, estRevenue: 0 },
    )
  }, [estimates])

  const totalHours = totals.estimatedMinutes / 60
  const actualHours = 0 // Phase 7
  const utilization = totalHours > 0 ? (actualHours / totalHours) * 100 : 0
  const health = getHealthStatus(utilization)

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Alert>
        <InfoIcon className="size-4" />
        <AlertDescription>
          Fixed projects are for budget tracking only — no invoices are generated.
        </AlertDescription>
      </Alert>

      {/* Budget Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Budget Overview</CardTitle>
        </CardHeader>
        <CardContent>
        {totalHours === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add budget estimates per category in the Settings tab.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <BudgetProgress used={actualHours * 60} budget={totals.estimatedMinutes} className="flex-1" />
              <span className="shrink-0 text-sm font-medium tabular-nums">{Math.round(utilization)}%</span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {actualHours}h / {Math.round(totalHours)}h
              </span>
              <HealthBadge status={health} />
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <span className="tabular-nums">Est. cost: {formatCurrency(totals.estCost, currency)}</span>
              <span className="tabular-nums">Est. revenue: {formatCurrency(totals.estRevenue, currency)}</span>
            </div>
          </div>
        )}
        </CardContent>
      </Card>

      {/* Per-Category Breakdown */}
      {estimates && estimates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Category Breakdown</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Estimated</th>
                <th className="px-4 py-2 font-medium">Actual</th>
                <th className="px-4 py-2 font-medium">Remaining</th>
                <th className="px-4 py-2 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((est) => {
                const estH = est.estimatedMinutes / 60
                return (
                  <tr key={est._id} className="border-t">
                    <td className="px-4 py-2.5">
                      <CategoryBadge name={est.categoryName} color={est.categoryColor} />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{Math.round(estH)}h</td>
                    <td className="px-4 py-2.5 tabular-nums">0h</td>
                    <td className="px-4 py-2.5 tabular-nums">{Math.round(estH)}h</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: "0%" }} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">0%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 tabular-nums">{Math.round(totalHours)}h</td>
                <td className="px-4 py-2.5 tabular-nums">0h</td>
                <td className="px-4 py-2.5 tabular-nums">{Math.round(totalHours)}h</td>
                <td className="px-4 py-2.5">
                  <span className="text-xs text-muted-foreground tabular-nums">0%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

    </div>
  )
}
