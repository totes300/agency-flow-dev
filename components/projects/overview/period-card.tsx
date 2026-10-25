"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { FileSpreadsheetIcon, FileTextIcon, ReceiptIcon, ExternalLinkIcon, DownloadIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { PeriodRow, ProjectBillingPeriods } from "@/convex/lib/billing/projectPeriods"
import { Button } from "@/components/ui/button"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { PeriodStateChip } from "@/components/billing/period-state-chip"
import {
  PeriodActionButton,
  WorksheetIconButton,
  invoiceHref,
  monthlyReportHref,
  type usePeriodActions,
} from "@/components/billing/period-actions"
import type { SelectedPeriod } from "@/lib/billing/period-selection"
import { formatMinor, formatMinutes } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The selected period's billing, in one card (docs/prd-project-billing-
 * redesign.md §7.3, P4): name + state chip → amount → one sub-line → the one
 * action → Documents. Only this period — nothing cross-period lives here.
 */
export function PeriodCard({
  projectId,
  model,
  selected,
  actions,
  from,
  onSelect,
}: {
  projectId: Id<"projects">
  model: ProjectBillingPeriods
  selected: SelectedPeriod
  actions: ReturnType<typeof usePeriodActions>
  from: string
  onSelect: (key: string) => void
}) {
  const row = selected.row
  const tm = model.billingType === "t_and_m"
  const currency = model.currency

  if (!row) {
    // A T&M month without billable work has no period (§5.1).
    return (
      <SideCard>
        <CardHeader title={selected.label} />
        <CardBody label="Nothing to bill" amount={formatMinor(0, currency)} dim sub={`No billable time in ${selected.label}`} />
      </SideCard>
    )
  }

  const copy = cardCopy(row, { tm, currency, todayStr: model.timezoneToday, overageRateMinor: model.terms.overageRateMinor })
  const target = { row, invoice: row.invoice, projectId }
  return (
    <SideCard>
      <CardHeader title={row.label} chip={<PeriodStateChip state={row.state} />} />
      <CardBody label={copy.label} amount={copy.amount} dim={copy.dim} sub={copy.sub}>
        {row.action ? (
          <div className="mt-3 flex flex-col gap-2">
            <PeriodActionButton
              action={row.action}
              size="default"
              className="w-full"
              pending={actions.pending !== null && actions.pending.endsWith(row.invoice?.id ?? "-")}
              onRun={() => actions.primary(target, row.action!)}
            />
            {row.action.blocked ? (
              <p className="text-center text-xs text-muted-foreground">
                {row.action.blocked.reason} ·{" "}
                <button
                  type="button"
                  className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                  onClick={() => onSelect(row.action!.blocked!.by.key)}
                >
                  Go to {row.action.blocked.by.label}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
      <Documents>
        {row.invoice ? (
          <DocumentRow
            icon={<ReceiptIcon />}
            name={`Invoice ${row.invoice.number ?? ""}`.trim()}
            meta={row.invoice.status === "draft" ? "Draft" : "PDF"}
            action={<OpenLink href={invoiceHref(row.invoice.id, from)} label="Open invoice" />}
          />
        ) : null}
        {row.documents.monthlyReport ? (
          <DocumentRow
            icon={<FileTextIcon />}
            name="Monthly report"
            meta={row.documents.monthlyReport === "final" ? "PDF" : "Preview"}
            action={<OpenLink href={monthlyReportHref(projectId, row, model.timezoneToday)} label="Open monthly report" download />}
          />
        ) : null}
        <DocumentRow
          icon={<FileSpreadsheetIcon />}
          name="Worksheet"
          meta="CSV"
          action={<WorksheetIconButton projectId={projectId} row={row} icon={<DownloadIcon />} />}
        />
      </Documents>
    </SideCard>
  )
}

/** §7.3 — label, amount and sub-line per state. */
function cardCopy(
  row: PeriodRow,
  ctx: { tm: boolean; currency: string; todayStr: string; overageRateMinor: number | null },
): { label: string; amount: string; dim?: boolean; sub: ReactNode } {
  const money = formatMinor(row.amountMinor, ctx.currency)
  const zero = formatMinor(0, ctx.currency)
  const over = row.overageMinutes > 0 ? `+${formatMinutes(row.overageMinutes)}` : null
  const inv = row.invoice
  const number = inv?.number ?? null
  const ends = shortDate(row.end)
  switch (row.state) {
    case "in_progress":
      return {
        label: ctx.tm ? "Billable so far" : "Overage so far",
        amount: money,
        sub: ctx.tm ? (
          `${formatMinutes(row.usageMinutes)} billable · closes after ${ends}`
        ) : over ? (
          <span className="text-destructive">{over} over</span>
        ) : (
          `Within budget · closes after ${ends}`
        ),
      }
    case "ready_to_invoice":
      return {
        label: ctx.tm ? "To invoice" : "Overage to invoice",
        amount: money,
        sub: ctx.tm ? (
          `${formatMinutes(row.usageMinutes)} billable`
        ) : (
          <>
            <span className="text-destructive">{over}</span> over {formatMinutes(row.includedMinutes ?? 0)}
            {ctx.overageRateMinor !== null ? ` · ${formatMinor(ctx.overageRateMinor, ctx.currency)}/h` : ""}
          </>
        ),
      }
    case "ready_to_close":
      return { label: "Nothing to invoice", amount: zero, dim: true, sub: ctx.tm ? "Ended · nothing billable" : "Ended · within budget" }
    case "needs_rate":
      return {
        label: "Overage not priced",
        amount: "—",
        dim: true,
        sub: (
          <>
            <span className="text-destructive">{over}</span> over · no overage rate
          </>
        ),
      }
    case "draft":
      return {
        label: ctx.tm ? "On draft" : "Overage on draft",
        amount: money,
        sub: number ? `${number} · not finalized yet` : "Draft invoice",
      }
    case "invoiced":
      return {
        label: ctx.tm ? "Invoiced" : "Overage invoiced",
        amount: money,
        sub: `${number ?? "Invoice"}${inv?.dueDate ? ` · due ${shortDate(inv.dueDate)}` : ""}`,
      }
    case "past_due":
      return {
        label: ctx.tm ? "Invoiced" : "Overage invoiced",
        amount: money,
        sub: (
          <>
            {number ?? "Invoice"} ·{" "}
            <span className="text-destructive">
              due {shortDate(inv?.dueDate ?? row.end)} · {overdueDays(inv?.dueDate ?? row.end, ctx.todayStr)} days overdue
            </span>
          </>
        ),
      }
    case "paid":
      return {
        label: ctx.tm ? "Billed" : "Overage billed",
        amount: money,
        sub: `${number ?? "Invoice"}${inv?.paidAt ? ` · paid ${dayOf(inv.paidAt)}` : ""}`,
      }
    case "closed":
      return {
        label: "Nothing to invoice",
        amount: zero,
        dim: true,
        sub: `Closed ${row.closedAt ? dayOf(row.closedAt) : ""} · within budget`,
      }
  }
}

// ─── Fixed fee ───────────────────────────────────────────────────────────────

const FIXED_CHIP = {
  not_invoiced: { label: "Not invoiced", tone: "neutral" },
  partly_invoiced: { label: "Partly invoiced", tone: "blue" },
  draft: { label: "Draft", tone: "amber" },
  fully_invoiced: { label: "Fully invoiced", tone: "green" },
} as const

/** The fixed-fee card (§7.3): remaining → "x of y invoiced" → Create invoice | Open draft. */
export function FixedFeeCard({
  model,
  from,
  onCreate,
  creating,
}: {
  model: ProjectBillingPeriods
  from: string
  onCreate: () => void
  creating: boolean
}) {
  const fixed = model.fixed
  if (!fixed) return null
  const chip = FIXED_CHIP[fixed.status]
  const currency = model.currency
  const invoices = model.invoices.filter((i) => i.status !== "void")
  return (
    <SideCard>
      <CardHeader title="Fixed fee" chip={<ColoredPillBadge tone={chip.tone} label={chip.label} showDot />} />
      <CardBody
        label="Remaining"
        amount={formatMinor(Math.max(0, fixed.remainingMinor), currency)}
        dim={fixed.remainingMinor <= 0}
        sub={`${formatMinor(fixed.invoicedMinor, currency)} of ${formatMinor(fixed.priceMinor, currency)} invoiced`}
      >
        <div className="mt-3">
          {fixed.draft ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={invoiceHref(fixed.draft.id, from)}>Open draft</Link>
            </Button>
          ) : fixed.remainingMinor > 0 ? (
            <Button className="w-full bg-foreground text-background hover:bg-foreground/85" onClick={onCreate} disabled={creating}>
              Create invoice
            </Button>
          ) : null}
        </div>
      </CardBody>
      {invoices.length > 0 ? (
        <Documents>
          {invoices.map((inv) => (
            <DocumentRow
              key={inv.id}
              icon={<ReceiptIcon />}
              name={`Invoice ${inv.number ?? ""}`.trim()}
              meta={inv.status === "draft" ? "Draft" : formatMinor(inv.totalMinor, currency)}
              action={<OpenLink href={invoiceHref(inv.id, from)} label="Open invoice" />}
            />
          ))}
        </Documents>
      ) : null}
    </SideCard>
  )
}

// ─── Shell ───────────────────────────────────────────────────────────────────

/** A white card on the grey side panel (P4). */
export function SideCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl bg-background ring-1 ring-border/70", className)}>{children}</section>
  )
}

function CardHeader({ title, chip }: { title: string; chip?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {chip}
    </div>
  )
}

function CardBody({
  label,
  amount,
  dim,
  sub,
  children,
}: {
  label: string
  amount: string
  dim?: boolean
  sub: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 px-3.5 pb-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", dim && "text-muted-foreground")}>{amount}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>
      {children}
    </div>
  )
}

function Documents({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border/60 px-1.5 pt-2 pb-1.5">
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Documents</p>
      {children}
    </div>
  )
}

function DocumentRow({ icon, name, meta, action }: { icon: ReactNode; name: string; meta: string; action: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md pr-1 pl-2 text-muted-foreground hover:bg-muted/60 [&>svg]:size-4">
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{name}</span>
      <span className="text-[11px]">{meta}</span>
      {action}
    </div>
  )
}

function OpenLink({ href, label, download = false }: { href: string; label: string; download?: boolean }) {
  return (
    <Button asChild variant="ghost" size="icon-xs" aria-label={label} title={label}>
      <Link href={href}>{download ? <DownloadIcon /> : <ExternalLinkIcon />}</Link>
    </Button>
  )
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** "Oct 24" for an epoch timestamp, in the viewer's calendar. */
function dayOf(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function overdueDays(dueDate: string, todayStr: string): number {
  return Math.max(1, Math.round((Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000))
}
