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
import { StatementDocument } from "@/components/projects/statement-document"

/**
 * Retainer statement page.
 *
 * URL: /projects/[id]/statements/[period] where period = "YYYY-MM".
 *
 * The statement is rendered live from `getRetainerStatement`. The "Save as
 * PDF" path uses the browser-native print dialog (window.print) — the same
 * pattern invoices use, no PDF library, no server render. A sibling
 * `print:hidden` class on the chrome keeps the printed output to just the
 * StatementDocument card.
 */
export default function ProjectStatementPage() {
  const { isAuthenticated } = useConvexAuth()
  const params = useParams()
  const projectId = params.id as Id<"projects">
  const periodParam = String(params.period ?? "")
  const parsed = parsePeriod(periodParam)

  // Skip the query for malformed period strings — the page will 404 below.
  const statement = useQuery(
    api.statements.getRetainerStatement,
    isAuthenticated && parsed
      ? { projectId, year: parsed.year, month: parsed.month }
      : "skip",
  )

  if (!parsed) notFound()
  if (statement === undefined) return <StatementSkeleton />
  if (statement === null) notFound()

  const backHref = `/projects/${projectId}`

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* Chrome — hidden when printing */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center justify-between gap-3 print:hidden"
      >
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" className="size-8" asChild>
            <Link href={backHref}>
              <ArrowLeftIcon className="size-4" />
            </Link>
          </Button>
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link href="/projects" className="hover:text-foreground">
                Projects
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li>
              <Link href={backHref} className="hover:text-foreground">
                {statement.project.name}
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="text-foreground">
              Statement · {statement.period.label}
            </li>
          </ol>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.print()}
        >
          <PrinterIcon data-icon="inline-start" className="size-3.5" />
          Save as PDF
        </Button>
      </nav>

      <StatementDocument statement={statement} />
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

function StatementSkeleton() {
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
