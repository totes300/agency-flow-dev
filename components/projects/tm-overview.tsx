"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { MetricCard } from "@/components/metric-card"
import { InfoIcon } from "lucide-react"

export function TmOverview() {
  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Alert>
        <InfoIcon className="size-4" />
        <AlertDescription>
          Every billable hour is invoiceable. Track time to build your billing queue.
        </AlertDescription>
      </Alert>

      {/* Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Billing Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard label="Uninvoiced" value="0h" detail="$0" />
            <MetricCard label="Last invoiced" value="Never" />
            <MetricCard label="This month" value="0h" />
            <MetricCard label="Last logged" value="—" />
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
