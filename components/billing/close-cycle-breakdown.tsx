"use client"

import { useMemo } from "react"
import { FilterIcon } from "lucide-react"
import { formatHoursCompact, formatSignedHours } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseWorkspaceData } from "@/convex/billingViews"

/**
 * Ledger row filter driven by the breakdown: a period month ("YYYY-MM") or
 * the carried-in opening row ("carried"). Null = no lens.
 */
export type CycleMonthLens = string

/**
 * The rollover balance ladder — the full story behind the header's cycle
 * balance. Reads as a bank statement: a carried-in opening row seeds the
 * running balance, then every month contributes `+included − logged`, and the
 * closing row is character-identical to the header stat (same server number,
 * same formatter). Months that haven't started render ghosted so the whole
 * allowance runway stays visible. Clicking a row lenses the ledger below to
 * that month's entries — the summary is a doorway to the evidence.
 */
export function CloseCycleBreakdown({
  data,
  activeLens,
  onLensChange,
}: {
  data: CloseWorkspaceData
  activeLens: CycleMonthLens | null
  onLensChange?: (lens: CycleMonthLens | null) => void
}) {
  const rows = data.monthlyBalances
  const inProgress = !data.periodElapsed && !data.isClosed
  const closingLabel = inProgress ? "Balance to date" : "Ending balance"
  const spansYears =
    rows.length > 0 &&
    rows[0].monthKey.slice(0, 4) !== rows[rows.length - 1].monthKey.slice(0, 4)

  // "Carried in from March 2026" when every carried entry shares one origin
  // month; plain "Carried in" for a mixed bag.
  const carriedLabel = useMemo(() => {
    const origins = new Set(
      data.entries
        .filter((r) => r.carried && !r.skipped)
        .map((r) => r.originMonthLabel),
    )
    return origins.size === 1
      ? `Carried in from ${[...origins][0]}`
      : "Carried in"
  }, [data.entries])

  function toggleLens(lens: CycleMonthLens) {
    onLensChange?.(activeLens === lens ? null : lens)
  }

  const monthsLeft = rows.filter((r) => r.pending).length

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border bg-muted/40 px-4 py-3">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b text-xs font-normal text-muted-foreground">
              <th className="pb-1.5 text-left font-normal">Month</th>
              <th className="pb-1.5 pl-6 text-right font-normal">Included</th>
              <th className="pb-1.5 pl-6 text-right font-normal">Logged</th>
              <th className="pb-1.5 pl-6 text-right font-normal">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.carriedInMinutes > 0 && (
              <LadderRow
                label={carriedLabel}
                included={null}
                logged={-data.carriedInMinutes}
                balance={-data.carriedInMinutes}
                active={activeLens === "carried"}
                onClick={
                  onLensChange ? () => toggleLens("carried") : undefined
                }
              />
            )}
            {rows.map((row) => (
              <LadderRow
                key={row.monthKey}
                label={monthLabel(row.monthKey, spansYears)}
                included={row.includedMinutes}
                logged={row.pending ? null : -row.loggedMinutes}
                balance={row.endingBalanceMinutes}
                pending={row.pending}
                active={activeLens === row.monthKey}
                onClick={
                  onLensChange && !row.pending
                    ? () => toggleLens(row.monthKey)
                    : undefined
                }
              />
            ))}
            <tr className="border-t">
              <td className="pt-2 text-muted-foreground" colSpan={3}>
                {closingLabel}
              </td>
              <td
                className={cn(
                  "pl-6 pt-2 text-right font-medium",
                  data.balanceToDateMinutes < 0 && "text-destructive",
                )}
              >
                {formatSignedHours(data.balanceToDateMinutes)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {inProgress && (
        <p className="text-xs text-muted-foreground">
          {formatHoursCompact(data.usageMinutes)} of{" "}
          {formatHoursCompact(data.includedMinutes)} used ·{" "}
          {monthsLeft > 0
            ? `${monthsLeft} ${monthsLeft === 1 ? "month" : "months"} left in cycle`
            : "final month in progress"}
        </p>
      )}
    </div>
  )
}

function LadderRow({
  label,
  included,
  logged,
  balance,
  pending = false,
  active = false,
  onClick,
}: {
  label: string
  /** Null renders an em-dash (the carried-in row has no allowance). */
  included: number | null
  /** Signed consumption; null renders an em-dash (pending month). */
  logged: number | null
  /** Running balance; null renders an em-dash (pending month). */
  balance: number | null
  pending?: boolean
  active?: boolean
  onClick?: () => void
}) {
  const interactive = onClick !== undefined
  return (
    <tr
      className={cn(
        "group",
        pending && "text-muted-foreground",
        interactive && "cursor-pointer hover:bg-muted/60",
        active && "bg-muted/80",
      )}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? active : undefined}
      aria-label={interactive ? `Filter the ledger to ${label}` : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <td className="py-1.5 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {label}
          {interactive && (
            <FilterIcon
              aria-hidden
              className={cn(
                "size-3 text-muted-foreground/70 transition-opacity",
                active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            />
          )}
        </span>
      </td>
      <td className="py-1.5 pl-6 text-right">
        {included === null ? <Dash /> : formatSignedHours(included)}
      </td>
      <td className="py-1.5 pl-6 text-right">
        {logged === null ? (
          <Dash />
        ) : logged === 0 ? (
          <span className="text-muted-foreground">0h 0m</span>
        ) : (
          formatHoursCompact(logged)
        )}
      </td>
      <td
        className={cn(
          "py-1.5 pl-6 text-right",
          balance !== null && balance < 0 && "text-destructive",
        )}
      >
        {balance === null ? <Dash /> : formatSignedHours(balance)}
      </td>
    </tr>
  )
}

function Dash() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      —
    </span>
  )
}

/** "April", or "April 2027" when the cycle spans a year boundary. */
function monthLabel(monthKey: string, withYear: boolean): string {
  const [y, m] = monthKey.split("-").map(Number)
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  })
  return withYear ? `${name} ${y}` : name
}
