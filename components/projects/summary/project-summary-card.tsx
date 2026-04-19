"use client"

import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { DateRangePreset } from "@/convex/lib/projectSummary"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TmSummaryCard } from "./tm-summary"
import { FixedSummaryCard } from "./fixed-summary"
import { RetainerSummaryCard } from "./retainer-summary"

const VALID_PRESETS: ReadonlyArray<DateRangePreset> = [
  "this_month",
  "this_quarter",
  "this_year",
  "all",
  "custom",
]

export function ProjectSummaryCard({ projectId }: { projectId: Id<"projects"> }) {
  const searchParams = useSearchParams()

  const dateRangeArg = useMemo(() => {
    const presetParam = searchParams.get("summaryRange")
    const preset = VALID_PRESETS.includes(presetParam as DateRangePreset)
      ? (presetParam as DateRangePreset)
      : undefined
    if (!preset) return undefined
    if (preset === "custom") {
      const from = searchParams.get("summaryFrom") ?? undefined
      const to = searchParams.get("summaryTo") ?? undefined
      return { preset, from, to }
    }
    return { preset }
  }, [searchParams])

  const cycleOffsetArg = useMemo(() => {
    const raw = searchParams.get("cycleOffset")
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }, [searchParams])

  const summary = useQuery(api.projects.getSummary, {
    projectId,
    dateRange: dateRangeArg,
    cycleOffset: cycleOffsetArg,
  })

  if (summary === undefined) return <ProjectSummaryCardSkeleton />
  if (summary === null) return null

  switch (summary.billingType) {
    case "t_and_m":
      return <TmSummaryCard summary={summary} />
    case "fixed":
      return <FixedSummaryCard projectId={projectId} summary={summary} />
    case "retainer":
      return <RetainerSummaryCard summary={summary} />
  }
}

/**
 * Skeleton — mirrors the 3-column shell of the real card. Column bodies
 * deliberately show a generic vertical stack of 2 rows (label + value)
 * instead of a grid, because the real content varies by billing type
 * (stack, lead+breakdown, grid) — a grid skeleton would promise structure
 * the real card may not render.
 */
export function ProjectSummaryCardSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      <div className="grid border-t border-border/60 divide-y divide-border/60 md:grid-cols-3 md:divide-x md:divide-y-0 md:divide-border/60">
        {Array.from({ length: 3 }).map((_, col) => (
          <div key={col} className="flex flex-col gap-4 px-5 py-4">
            <Skeleton className="h-4 w-28" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 2 }).map((__, row) => (
                <div key={row} className="flex flex-col gap-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
