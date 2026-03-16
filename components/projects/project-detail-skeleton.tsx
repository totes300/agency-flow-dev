import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"

export function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Back button — matches: <Button variant="ghost" size="sm"> ← Projects */}
      <Skeleton className="mb-2 h-8 w-24 rounded-md" />

      {/* Header row — matches: title + badge + right-side actions */}
      <div className="flex items-start justify-between">
        <div>
          {/* Title + BillingTypeBadge */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          {/* Metadata: code · client · currency */}
          <div className="mt-1.5 flex items-center gap-2">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-8" />
          </div>
        </div>
        {/* Right side: "Last logged" + Edit + ⋮ */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-8 w-14 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </div>

      {/* Tabs strip — matches: [Overview] [Settings] */}
      <div className="flex gap-1">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Overview content — matches the most common layout (Card + metrics + breakdown) */}
      <div className="mt-6 space-y-6">
        {/* Alert/info banner */}
        <Skeleton className="h-12 w-full rounded-lg" />

        {/* Main overview card — matches Cycle Overview / Budget Overview */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <Skeleton className="h-2.5 w-full rounded-full" />
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

        {/* Second card — matches Monthly Breakdown / Per-Category table */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Accordion rows / table rows */}
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

        {/* Time Log placeholder shape */}
        <div>
          <Skeleton className="mb-3 h-4 w-16" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
