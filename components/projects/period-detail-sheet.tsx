"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useQuery } from "convex/react"
import { ArrowUpRightIcon, ExternalLinkIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  formatCurrency,
  formatInvoiceNumber,
  formatMinutes,
} from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Phase 8 Slice 4 — period drill-down (Principle #5: progressive
 * disclosure).
 *
 * This is the ONLY UI surface where the collapsed row-level `Closed`
 * badge splits back out into the financial reason. The row stays one
 * axis; admins who need to know "how much of this month was covered by
 * the retainer vs invoiced as overage" come here.
 *
 * Reads `api.timeEntries.listProjectEntries` constrained to the period's
 * date range. NO new schema, NO new query parameter — per parent PRD
 * § Reporting Changes, `settledReason` is the durable truth and the
 * client-side group-by is the proof-of-life that the schema preserves
 * full fidelity behind the collapsed row badge.
 *
 * Three sections, each only rendered when its bucket is non-empty:
 *   1. Covered by retainer — `settledReason === "retainer_included"`
 *   2. Invoiced overage    — `settledReason === "invoiced"` (with the
 *      linked invoice number as a click-through)
 *   3. Open / Draft        — any entries that are NOT yet settled (a
 *      reopened period mid-edit, or an open period viewed for context)
 */
export function PeriodDetailSheet({
  open,
  onOpenChange,
  projectId,
  periodStart,
  periodEnd,
  periodLabel,
  currency,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  projectId: Id<"projects">
  periodStart: string   // YYYY-MM-01
  periodEnd: string     // YYYY-MM-DD (last day of month)
  periodLabel: string   // "March 2026"
  currency: string
}) {
  const data = useQuery(
    api.timeEntries.listProjectEntries,
    open
      ? {
          projectId,
          // Reuse the existing date-range filter — the server already
          // accepts `fromDate`/`toDate`, so the period drill-down adds no
          // new query surface area.
          fromDate: periodStart,
          toDate: periodEnd,
        }
      : "skip",
  )

  const grouped = useMemo(() => groupBySettledReason(data?.entries), [data])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{periodLabel}</SheetTitle>
          <SheetDescription>
            Time logged on this project in this month, split by how it
            was settled.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {data === undefined ? (
            <DrillDownSkeleton />
          ) : grouped.total.entryCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              No time logged in this period.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <TotalsRow grouped={grouped} currency={currency} />
              {grouped.retainer.entryCount > 0 && (
                <SectionCard
                  title="Covered by retainer"
                  description="Hours included in the monthly fee — no extra revenue."
                  minutes={grouped.retainer.minutes}
                  currency={currency}
                  tone="neutral"
                />
              )}
              {grouped.invoiced.entryCount > 0 && (
                <SectionCard
                  title="Invoiced overage"
                  description="Hours billed hourly on a finalized invoice."
                  minutes={grouped.invoiced.minutes}
                  amount={grouped.invoiced.amount}
                  currency={currency}
                  tone="green"
                  invoiceLinks={grouped.invoiced.invoices}
                />
              )}
              {grouped.fixed.entryCount > 0 && (
                <SectionCard
                  title="Covered by fixed price"
                  description="Hours rolled into the project's fixed fee — no extra revenue."
                  minutes={grouped.fixed.minutes}
                  currency={currency}
                  tone="neutral"
                />
              )}
              {(grouped.draft.entryCount > 0 ||
                grouped.open.entryCount > 0) && (
                <SectionCard
                  title="Open / draft"
                  description="Hours still in flight — not yet settled."
                  minutes={grouped.open.minutes + grouped.draft.minutes}
                  currency={currency}
                  tone="amber"
                  invoiceLinks={grouped.draft.invoices}
                />
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Grouping (pure, exported for tests) ────────────────────────────────────

type EntryShape = {
  durationMinutes: number
  isBillable: boolean
  billableRate: number
  invoiceId: Id<"invoices"> | undefined
  invoicePrefix: string | undefined
  invoiceNumber: number | undefined
  settledAt: number | undefined
  settledReason:
    | "invoiced"
    | "retainer_included"
    | "fixed_included"
    | undefined
}

export type DrillDownGroup = {
  minutes: number
  amount: number
  entryCount: number
  /** De-duplicated invoice references for the link-out chips. */
  invoices: Array<{
    id: Id<"invoices">
    prefix: string
    number: number
  }>
}

export type DrillDownGroups = {
  retainer: DrillDownGroup
  invoiced: DrillDownGroup
  fixed: DrillDownGroup
  draft: DrillDownGroup
  open: DrillDownGroup
  nonBillable: DrillDownGroup
  total: { minutes: number; amount: number; entryCount: number }
}

function emptyGroup(): DrillDownGroup {
  return { minutes: 0, amount: 0, entryCount: 0, invoices: [] }
}

/**
 * Pure client-side aggregator. Mirrors `entryStatus()` for the bucket
 * choice but additionally splits `closed` by `settledReason` so the
 * drill-down can render the split.
 *
 * Invoice de-duplication: a month can carry overage on one invoice (the
 * common case) or multiple if the admin generated more than one — we
 * keep them all so the user can click through to each.
 */
export function groupBySettledReason(
  entries: EntryShape[] | undefined,
): DrillDownGroups {
  const out: DrillDownGroups = {
    retainer: emptyGroup(),
    invoiced: emptyGroup(),
    fixed: emptyGroup(),
    draft: emptyGroup(),
    open: emptyGroup(),
    nonBillable: emptyGroup(),
    total: { minutes: 0, amount: 0, entryCount: 0 },
  }
  if (!entries) return out

  const seenInvoices = new Map<string, Set<string>>()
  function recordInvoice(group: DrillDownGroup, key: string, e: EntryShape) {
    if (!e.invoiceId || !e.invoicePrefix || e.invoiceNumber == null) return
    let seen = seenInvoices.get(key)
    if (!seen) {
      seen = new Set()
      seenInvoices.set(key, seen)
    }
    const idStr = e.invoiceId.toString()
    if (seen.has(idStr)) return
    seen.add(idStr)
    group.invoices.push({
      id: e.invoiceId,
      prefix: e.invoicePrefix,
      number: e.invoiceNumber,
    })
  }

  for (const e of entries) {
    const amount = (e.durationMinutes / 60) * e.billableRate
    out.total.minutes += e.durationMinutes
    out.total.entryCount += 1
    if (e.isBillable) out.total.amount += amount

    if (!e.isBillable) {
      out.nonBillable.minutes += e.durationMinutes
      out.nonBillable.entryCount += 1
      continue
    }

    if (e.settledReason === "retainer_included") {
      out.retainer.minutes += e.durationMinutes
      out.retainer.entryCount += 1
      continue
    }
    if (e.settledReason === "invoiced") {
      out.invoiced.minutes += e.durationMinutes
      out.invoiced.amount += amount
      out.invoiced.entryCount += 1
      recordInvoice(out.invoiced, "invoiced", e)
      continue
    }
    if (e.settledReason === "fixed_included") {
      out.fixed.minutes += e.durationMinutes
      out.fixed.entryCount += 1
      continue
    }
    // Not settled. Distinguish draft (on a draft invoice) from open
    // (truly unbilled) — the drill-down section collapses both into one
    // visual row but a downstream report may need the distinction, so we
    // keep separate counters.
    if (e.invoiceId !== undefined) {
      out.draft.minutes += e.durationMinutes
      out.draft.amount += amount
      out.draft.entryCount += 1
      recordInvoice(out.draft, "draft", e)
    } else {
      out.open.minutes += e.durationMinutes
      out.open.amount += amount
      out.open.entryCount += 1
    }
  }

  return out
}

// ─── Render helpers ─────────────────────────────────────────────────────────

function TotalsRow({
  grouped,
  currency,
}: {
  grouped: DrillDownGroups
  currency: string
}) {
  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Total hours
        </span>
        <span className="text-base font-semibold tabular-nums">
          {formatMinutes(grouped.total.minutes)}
        </span>
      </div>
      <div className="flex flex-col gap-1 text-right">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Billed here
        </span>
        <span className="text-base font-semibold tabular-nums">
          {formatCurrency(grouped.invoiced.amount, currency)}
        </span>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  description,
  minutes,
  amount,
  currency,
  tone,
  invoiceLinks,
}: {
  title: string
  description: string
  minutes: number
  amount?: number
  currency: string
  tone: "neutral" | "green" | "amber"
  invoiceLinks?: Array<{ id: Id<"invoices">; prefix: string; number: number }>
}) {
  return (
    <section
      className={cn(
        "rounded-lg border bg-card p-4",
        tone === "green" && "border-green-200 dark:border-green-900",
        tone === "amber" && "border-amber-200 dark:border-amber-900",
      )}
      data-tone={tone}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-base font-semibold tabular-nums">
            {formatMinutes(minutes)}
          </span>
          {amount !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCurrency(amount, currency)}
            </span>
          )}
        </div>
      </header>

      {invoiceLinks && invoiceLinks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
          {invoiceLinks.map((inv) => {
            const label = formatInvoiceNumber(inv.prefix, inv.number)
            return (
              <Link
                key={inv.id.toString()}
                href={`/invoices/${label}`}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs text-foreground/80 hover:text-foreground hover:underline"
              >
                {label}
                <ArrowUpRightIcon className="size-3" aria-hidden />
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

function DrillDownSkeleton() {
  // Content-aware: totals card + two section cards mirroring the most
  // common output shape (retainer + invoiced).
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Used by the page detail view's link-out chip in section headers (kept
// in the file so tree-shaking is straightforward, but exported for any
// downstream consumer that wants the same chip styling).
export { ExternalLinkIcon as PeriodDetailExternalLinkIcon }
