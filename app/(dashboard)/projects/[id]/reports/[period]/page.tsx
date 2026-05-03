"use client"

import { useParams } from "next/navigation"
import Link from "next/link"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, PrinterIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MonthlyReportDocument } from "@/components/projects/monthly-report-document"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"

/**
 * Retainer Monthly Report page (D8 in `docs/invoicing-refactor.md`).
 *
 * URL: /projects/[id]/reports/[period] where period = "YYYY-MM".
 *
 * The report is rendered live from `getRetainerStatement` (server symbol
 * kept; only the visible header + this route URL are rebranded — see Open
 * Question 1). The "Save as PDF" path uses the browser-native print dialog
 * (window.print) — same pattern invoices use, no PDF library, no server
 * render. A sibling `print:hidden` class on the chrome keeps the printed
 * output to just the MonthlyReportDocument card.
 */
export default function ProjectMonthlyReportPage() {
  const { isAuthenticated } = useConvexAuth()
  const params = useParams()
  const projectId = params.id as Id<"projects">
  const periodParam = String(params.period ?? "")
  const parsed = parsePeriod(periodParam)

  // Skip the query for malformed period strings — the page will 404 below.
  const report = useQuery(
    api.statements.getRetainerStatement,
    isAuthenticated && parsed
      ? { projectId, year: parsed.year, month: parsed.month }
      : "skip",
  )
  useBreadcrumbTitle(report ? `Report · ${report.period.label}` : null)

  if (!parsed) notFound()
  if (report === undefined) return <ReportSkeleton />
  if (report === null) notFound()

  const backHref = `/projects/${projectId}`

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* Chrome — hidden when printing */}
      <nav
        aria-label="Document navigation"
        className="flex items-center justify-between gap-3 print:hidden"
      >
        <Button variant="ghost" size="icon" aria-label="Back" className="size-8" asChild>
          <Link href={backHref}>
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.print()}
        >
          <PrinterIcon data-icon="inline-start" className="size-3.5" />
          Save as PDF
        </Button>
      </nav>

      <MonthlyReportDocument report={report} />
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * URL period token → {year, month}. Accepts only the canonical "YYYY-MM"
 * shape — anything else (including out-of-range months) returns null so the
 * page can 404 without ever hitting the query.
 */
function parsePeriod(raw: string): { year: number; month: number } | null {
  const m = raw.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (year < 2000 || month < 1 || month > 12) return null
  return { year, month }
}

function ReportSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}
