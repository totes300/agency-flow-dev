"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"
import type { TmSummary, DateRangePreset } from "@/convex/lib/projectSummary"
import { SummaryCardShell } from "./primitives/summary-card-shell"
import { SummaryColumn } from "./primitives/summary-column"
import { MetricRow } from "./primitives/metric-row"
import { MetricGroup } from "./primitives/metric-group"
import { RoleGatedColumn } from "./primitives/role-gated-column"
import { formatCurrencyPrecise, formatMinutes } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { CalendarIcon, ChevronDownIcon } from "lucide-react"

const PRESET_LABELS: Record<DateRangePreset, string> = {
  this_month: "This month",
  this_quarter: "This quarter",
  this_year: "This year",
  all: "All time",
  custom: "Custom",
}

export function TmSummaryCard({ summary }: { summary: TmSummary }) {
  const { dateRange, currency, subtitle, timeBreakdown, billingStatus, profitability } = summary

  return (
    <SummaryCardShell
      title="Project Finances"
      subtitle={subtitle}
      trailing={<DateRangePicker dateRange={dateRange} />}
    >
      {billingStatus ? (
        <SummaryColumn title="Billing status">
          <MetricRow
            label="Unbilled Amount"
            value={formatCurrencyPrecise(billingStatus.unbilledAmount, currency)}
            detail={`${formatMinutes(billingStatus.unbilledMinutes)} unbilled hours`}
          />
          <MetricRow
            label="Billed Amount"
            value={formatCurrencyPrecise(billingStatus.billedAmount, currency)}
            detail={`${formatMinutes(billingStatus.billedMinutes)} billed hours`}
          />
        </SummaryColumn>
      ) : (
        <RoleGatedColumn title="Billing status" />
      )}

      <SummaryColumn title="Time breakdown">
        <MetricRow label="Total hours" value={formatMinutes(timeBreakdown.totalMinutes)} />
        <MetricGroup>
          <MetricRow label="Billable hours" value={formatMinutes(timeBreakdown.billableMinutes)} />
          <MetricRow label="Non-billable hours" value={formatMinutes(timeBreakdown.nonBillableMinutes)} />
        </MetricGroup>
      </SummaryColumn>

      {profitability ? (
        <SummaryColumn title="Profitability">
          <MetricGroup>
            <MetricRow
              label="Earned Revenue"
              value={formatCurrencyPrecise(profitability.revenue, currency)}
            />
            <MetricRow
              label="Profit"
              value={formatCurrencyPrecise(profitability.profit, currency)}
              variant={profitability.profit < 0 ? "destructive" : "default"}
            />
            <MetricRow
              label="Total cost"
              value={formatCurrencyPrecise(profitability.totalCost, currency)}
            />
            <MetricRow
              label="Margin"
              value={profitability.marginPercent !== null ? `${profitability.marginPercent}%` : "—"}
              variant={profitability.marginPercent !== null && profitability.marginPercent < 0 ? "destructive" : "default"}
            />
          </MetricGroup>
        </SummaryColumn>
      ) : (
        <RoleGatedColumn title="Profitability" />
      )}
    </SummaryCardShell>
  )
}

// ─── Date range picker ────────────────────────────────────────────────────────

function DateRangePicker({ dateRange }: { dateRange: TmSummary["dateRange"] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const setPreset = useCallback(
    (preset: DateRangePreset) => {
      const params = new URLSearchParams(searchParams.toString())
      if (preset === "all") {
        params.delete("summaryRange")
        params.delete("summaryFrom")
        params.delete("summaryTo")
      } else {
        params.set("summaryRange", preset)
        if (preset !== "custom") {
          params.delete("summaryFrom")
          params.delete("summaryTo")
        }
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("summaryRange", "custom")
      params.set("summaryFrom", from)
      params.set("summaryTo", to)
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const label = dateRange.preset === "custom"
    ? `${dateRange.from} – ${dateRange.to}`
    : PRESET_LABELS[dateRange.preset]

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <CalendarIcon className="size-3.5" />
            {label}
            <ChevronDownIcon className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup
            value={dateRange.preset}
            onValueChange={(v) => setPreset(v as DateRangePreset)}
          >
            <DropdownMenuRadioItem value="this_month">This month</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="this_quarter">This quarter</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="this_year">This year</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="all">All time</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              >
                Custom range…
              </button>
            </PopoverTrigger>
            <PopoverContent side="left" align="start" className="w-auto p-3">
              <CustomRangeForm
                initialFrom={dateRange.preset === "custom" ? dateRange.from : ""}
                initialTo={dateRange.preset === "custom" ? dateRange.to : ""}
                onApply={setCustomRange}
              />
            </PopoverContent>
          </Popover>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function CustomRangeForm({
  initialFrom,
  initialTo,
  onApply,
}: {
  initialFrom: string
  initialTo: string
  onApply: (from: string, to: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const from = (form.elements.namedItem("from") as HTMLInputElement).value
        const to = (form.elements.namedItem("to") as HTMLInputElement).value
        if (!from || !to) return
        if (from > to) {
          setError("From date must be on or before To date.")
          return
        }
        setError(null)
        onApply(from, to)
      }}
    >
      <label className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">From</span>
        <Input type="date" name="from" defaultValue={initialFrom} className="h-8 w-36" required />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">To</span>
        <Input type="date" name="to" defaultValue={initialTo} className="h-8 w-36" required />
      </label>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="submit" size="sm" className="self-end">Apply</Button>
    </form>
  )
}
