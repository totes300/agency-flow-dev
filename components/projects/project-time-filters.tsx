"use client"

import { useCallback, useMemo, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldLabel } from "@/components/ui/field"
import { UserAvatar } from "@/components/user-avatar"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { cn } from "@/lib/utils"
import { LayoutGridIcon, ListFilterIcon, SearchIcon } from "lucide-react"
import {
  DATE_RANGE_PRESET_LABELS,
  type DateRangePreset,
} from "@/lib/date-buckets"
import {
  formatDateToYMDOrUndefined,
  parseYMDToLocalDate,
} from "@/lib/format"

const ALL_VALUE = "__all__"

type Member = {
  id: string
  name: string
  imageUrl: string | undefined
}

const BILLING_STATUS_OPTIONS = [
  { value: ALL_VALUE, label: "All" },
  { value: "billable_uninvoiced", label: "Billable · Uninvoiced" },
  { value: "invoiced", label: "Invoiced" },
  { value: "non_billable", label: "Non-billable" },
] as const

const GROUP_BY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "day", label: "By Day" },
  { value: "week", label: "By Week" },
  { value: "month", label: "By Month" },
  { value: "member", label: "By Member" },
  { value: "task", label: "By Task" },
] as const

const DATE_RANGE_ORDER: DateRangePreset[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "all",
  "custom",
]

/**
 * Toolbar for the project Time tab. Layout matches Bonsai:
 *   [Search]  [Filter N]  [Group by ▾]         ml-auto: [actions slot]
 * Where the filter popover collapses member / billing status / date range
 * into a single affordance so the row doesn't blow past the container.
 */
export function ProjectTimeFilters({
  availableMembers,
  billingType,
  actions,
}: {
  availableMembers: Member[]
  billingType: string
  /** Right-aligned action buttons (Invoice Unbilled Hours, Add Time, etc.). */
  actions?: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeMember = searchParams.get("member") ?? ""
  const activeBillingStatus = searchParams.get("billingStatus") ?? ""
  const activeGroupBy = searchParams.get("groupBy") ?? "day"
  // Default date range is "this_month" — must match `DEFAULT_DATE_RANGE` in
  // `project-time.tsx` so the badge count and the orchestrator's `hasFilters`
  // stay aligned.
  const activeDateRange = (searchParams.get("dateRange") ?? "this_month") as DateRangePreset
  const customFrom = searchParams.get("from") ?? undefined
  const customTo = searchParams.get("to") ?? undefined

  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

  const setParams = useCallback(
    (updates: Array<[string, string | undefined]>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of updates) {
        if (!value || value === ALL_VALUE) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname)
    },
    [searchParams, router, pathname],
  )

  const setParam = useCallback(
    (key: string, value: string | undefined) => setParams([[key, value]]),
    [setParams],
  )

  // Count of active filters rendered inside the popover — used for the
  // badge on the Filter button.
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (activeMember) count++
    if (activeBillingStatus && activeBillingStatus !== ALL_VALUE) count++
    if (activeDateRange !== "this_month") count++
    return count
  }, [activeMember, activeBillingStatus, activeDateRange])

  const handleDateRangeChange = useCallback(
    (value: string) => {
      const next = value as DateRangePreset
      if (next === "this_month") {
        // Matches the orchestrator's default — drop the param entirely so
        // links stay clean.
        setParams([
          ["dateRange", undefined],
          ["from", undefined],
          ["to", undefined],
        ])
        return
      }
      if (next !== "custom") {
        setParams([
          ["dateRange", next],
          ["from", undefined],
          ["to", undefined],
        ])
        return
      }
      setParams([["dateRange", "custom"]])
    },
    [setParams],
  )

  const handleCustomFromChange = useCallback(
    (d: Date | undefined) => {
      setParams([
        ["dateRange", "custom"],
        ["from", formatDateToYMDOrUndefined(d)],
      ])
    },
    [setParams],
  )

  const handleCustomToChange = useCallback(
    (d: Date | undefined) => {
      setParams([
        ["dateRange", "custom"],
        ["to", formatDateToYMDOrUndefined(d)],
      ])
    },
    [setParams],
  )

  const handleClearAll = useCallback(() => {
    // "Clear" restores the defaults — date range goes back to this_month,
    // which is represented by the absence of the `dateRange` param.
    setParams([
      ["member", undefined],
      ["billingStatus", undefined],
      ["dateRange", undefined],
      ["from", undefined],
      ["to", undefined],
    ])
  }, [setParams])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search task or note"
          aria-label="Search time entries"
          className="h-9 pl-8"
        />
      </div>

      <FilterPopover
        billingType={billingType}
        availableMembers={availableMembers}
        activeMember={activeMember}
        activeBillingStatus={activeBillingStatus}
        activeDateRange={activeDateRange}
        customFrom={customFrom}
        customTo={customTo}
        activeFilterCount={activeFilterCount}
        onMemberChange={(v) => setParam("member", v)}
        onBillingStatusChange={(v) => setParam("billingStatus", v)}
        onDateRangeChange={handleDateRangeChange}
        onCustomFromChange={handleCustomFromChange}
        onCustomToChange={handleCustomToChange}
        onClearAll={handleClearAll}
      />

      <Select
        value={activeGroupBy}
        onValueChange={(v) => {
          setParam("groupBy", v === "day" ? undefined : v)
        }}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <span className="flex items-center gap-2">
            <LayoutGridIcon aria-hidden className="size-3.5 text-muted-foreground" />
            <SelectValue placeholder="Group by" />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {GROUP_BY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

function FilterPopover({
  billingType,
  availableMembers,
  activeMember,
  activeBillingStatus,
  activeDateRange,
  customFrom,
  customTo,
  activeFilterCount,
  onMemberChange,
  onBillingStatusChange,
  onDateRangeChange,
  onCustomFromChange,
  onCustomToChange,
  onClearAll,
}: {
  billingType: string
  availableMembers: Member[]
  activeMember: string
  activeBillingStatus: string
  activeDateRange: DateRangePreset
  customFrom: string | undefined
  customTo: string | undefined
  activeFilterCount: number
  onMemberChange: (value: string) => void
  onBillingStatusChange: (value: string) => void
  onDateRangeChange: (value: string) => void
  onCustomFromChange: (d: Date | undefined) => void
  onCustomToChange: (d: Date | undefined) => void
  onClearAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const isTm = billingType === "t_and_m"
  const hasInvalidCustomRange =
    activeDateRange === "custom" &&
    !!customFrom &&
    !!customTo &&
    customTo < customFrom

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          aria-label="Filter"
        >
          <ListFilterIcon aria-hidden className="size-3.5" />
          Filter
          {activeFilterCount > 0 && (
            <span
              className={cn(
                "ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-xs font-medium text-primary-foreground",
                "h-5",
              )}
              aria-label={`${activeFilterCount} active filters`}
            >
              {activeFilterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-4">
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="filter-member">Member</FieldLabel>
            <Select
              value={activeMember || ALL_VALUE}
              onValueChange={onMemberChange}
            >
              <SelectTrigger id="filter-member" className="w-full">
                <SelectValue placeholder="All members" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_VALUE}>All members</SelectItem>
                  {availableMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex items-center gap-2">
                        <UserAvatar
                          name={m.name}
                          imageUrl={m.imageUrl}
                          size="sm"
                        />
                        {m.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {isTm && (
            <Field>
              <FieldLabel htmlFor="filter-status">Billing status</FieldLabel>
              <Select
                value={activeBillingStatus || ALL_VALUE}
                onValueChange={onBillingStatusChange}
              >
                <SelectTrigger id="filter-status" className="w-full">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {BILLING_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="filter-date-range">Date range</FieldLabel>
            <Select
              value={activeDateRange}
              onValueChange={onDateRangeChange}
            >
              <SelectTrigger id="filter-date-range" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DATE_RANGE_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>
                      {DATE_RANGE_PRESET_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {activeDateRange === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="filter-date-from">From</FieldLabel>
                <DatePicker
                  id="filter-date-from"
                  value={parseYMDToLocalDate(customFrom)}
                  onChange={onCustomFromChange}
                  placeholder="Start"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="filter-date-to">To</FieldLabel>
                <DatePicker
                  id="filter-date-to"
                  value={parseYMDToLocalDate(customTo)}
                  onChange={onCustomToChange}
                  placeholder="End"
                  aria-invalid={hasInvalidCustomRange}
                />
              </Field>
              {hasInvalidCustomRange && (
                <p className="col-span-2 text-xs text-destructive">
                  End date must be on or after start date.
                </p>
              )}
            </div>
          )}

          <div className="-mx-4 -mb-4 mt-1 flex items-center justify-between border-t px-4 py-3">
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onClearAll}
              disabled={activeFilterCount === 0}
              className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
