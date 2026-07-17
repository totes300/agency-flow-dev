import { formatHoursCompact, formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseWorkspaceData } from "@/convex/close"

/**
 * Inline budget summary line for the Close workspace header — the single place
 * the money consequence is stated while reviewing (PRD story 7). Every number
 * comes from the server `billingScope` report; this component only formats.
 *
 * Shape adapts by billing type:
 *   - retainer: Included · Logged · Balance ( · Overage × rate = amount )
 *   - T&M:      Logged · Billable amount
 *   - fixed:    Remaining fee
 *
 * Raw ledger note (PRD story 8) states explicitly that nothing is rounded and
 * nothing locks until commit — so the owner trusts that reviewing is safe.
 */
export function CloseBudgetSummary({ data }: { data: CloseWorkspaceData }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {data.billingType === "retainer" && <RetainerSummary data={data} />}
        {data.billingType === "t_and_m" && <TmSummary data={data} />}
        {data.billingType === "fixed" && <FixedSummary data={data} />}
      </div>
      {/* The reviewing-is-safe reassurance only makes sense while the period
          is still open — a closed period is already committed history. */}
      {data.fromSettlementStamps ? (
        <p className="text-xs text-muted-foreground">
          Closed period — the ledger below is the committed record.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Raw hours — nothing is rounded here, and nothing locks until you
          commit.
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "over" | "within"
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          tone === "over" && "text-destructive",
          tone === "within" && "text-emerald-600 dark:text-emerald-500",
        )}
      >
        {value}
      </span>
    </span>
  )
}

function Sep() {
  return <span aria-hidden className="text-muted-foreground/40">·</span>
}

function RetainerSummary({ data }: { data: CloseWorkspaceData }) {
  const over = !data.withinBudget
  return (
    <>
      <Stat label="Included" value={formatHoursCompact(data.includedMinutes)} />
      <Sep />
      <Stat label="Logged" value={formatHoursCompact(data.usageMinutes)} />
      <Sep />
      <Stat
        label="Balance"
        value={formatHoursCompact(data.balanceMinutes)}
        tone={over ? "over" : "within"}
      />
      {over && (
        <>
          <Sep />
          <span className="inline-flex items-baseline gap-1">
            <span className="text-muted-foreground">Overage</span>
            <span className="font-medium tabular-nums text-destructive">
              {formatHoursCompact(data.overageMinutes)}
            </span>
            {data.overageRate != null && data.overageRate > 0 ? (
              <>
                <span className="text-muted-foreground">×</span>
                <span className="tabular-nums">
                  {formatCurrency(data.overageRate, data.currency)}/h
                </span>
                <span className="text-muted-foreground">=</span>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(data.amount, data.currency)}
                </span>
              </>
            ) : (
              <span className="text-destructive">· no overage rate set</span>
            )}
          </span>
        </>
      )}
    </>
  )
}

function TmSummary({ data }: { data: CloseWorkspaceData }) {
  return (
    <>
      <Stat label="Logged" value={formatHoursCompact(data.usageMinutes)} />
      <Sep />
      <span className="inline-flex items-baseline gap-1">
        <span className="text-muted-foreground">Billable</span>
        <span className="font-semibold tabular-nums">
          {formatCurrency(data.amount, data.currency)}
        </span>
      </span>
    </>
  )
}

function FixedSummary({ data }: { data: CloseWorkspaceData }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">Remaining fee</span>
      <span className="font-semibold tabular-nums">
        {formatCurrency(data.amount, data.currency)}
      </span>
    </span>
  )
}
