"use client"

import Link from "next/link"
import { CheckCircle2Icon } from "lucide-react"
import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import { formatInvoiceNumber, formatLastInvoiced, pluralize } from "@/lib/format"

type Context = NonNullable<FunctionReturnType<typeof api.invoices.getInboxEmptyStateContext>>

/**
 * "All caught up" reward state — rendered when both Overdue and To-generate
 * sections are empty. Centered card with a green check, headline, and two
 * context lines (last invoice + days to next month-close) so the empty state
 * still carries enough signal to feel like an achievement (US 23) rather
 * than a void.
 *
 * Single source of truth for empty-state copy on the Inbox; the dashboard
 * may eventually reuse this shape (`getInboxEmptyStateContext` is generic
 * enough to support it).
 */
export function InboxEmptyState({
  context,
  timezone,
}: {
  context: Context
  timezone: string
}) {
  const { lastInvoice, daysToNextMonthClose } = context
  // Conversational headline: forward-looking next milestone instead of just
  // "no data" feedback. Notion-style — empty states tell you what's next.
  const headline =
    daysToNextMonthClose === 0
      ? "Inbox zero — month closes today."
      : `Inbox zero — next month-close in ${daysToNextMonthClose} ${pluralize(
          daysToNextMonthClose,
          "day",
          "days",
        )}.`

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-green-100 text-green-600 dark:bg-green-950/50 dark:text-green-300">
        <CheckCircle2Icon className="size-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{headline}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing to bill, nothing overdue. Within-budget retainer months
        appear as downloadable statements on each project page.
      </p>
      {lastInvoice ? (
        <p className="mt-5 text-xs text-muted-foreground">
          Last invoiced{" "}
          {formatLastInvoiced(lastInvoice.issueDateTimestamp, { timezone })} ·{" "}
          <Link
            href={`/invoices/${lastInvoice.id}`}
            className="font-mono hover:text-foreground hover:underline"
          >
            {formatInvoiceNumber(lastInvoice.prefix, lastInvoice.number)}
          </Link>{" "}
          · {lastInvoice.clientName}
        </p>
      ) : (
        <p className="mt-5 text-xs text-muted-foreground">
          No finalized invoices yet.
        </p>
      )}
    </div>
  )
}
