"use client"

import { useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import type { Doc } from "@/convex/_generated/dataModel"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import {
  ProjectTimeFilterButton,
  ProjectTimeActiveFilters,
} from "@/components/projects/project-time-filter-bar"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { CalendarIcon, LayoutGridIcon, SearchIcon } from "lucide-react"
import {
  DATE_RANGE_PRESET_LABELS,
  DEFAULT_TIME_DATE_RANGE,
  parseDateRangePreset,
  type DateRangePreset,
} from "@/lib/date-buckets"
import {
  formatDateToYMDOrUndefined,
  parseYMDToLocalDate,
} from "@/lib/format"

type Member = {
  id: string
  name: string
  imageUrl: string | undefined
}

const GROUP_BY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "day", label: "By Day" },
  { value: "week", label: "By Week" },
  { value: "month", label: "By Month" },
  { value: "member", label: "By Member" },
  { value: "task", label: "By Task" },
] as const

const DATE_RANGE_ORDER: DateRangePreset[] = [
  "this_month",
  "last_month",
  "this_week",
  "last_week",
  "last_90_days",
  "this_year",
  "all",
  "custom",
]

/**
 * Toolbar for the project Time tab. Layout:
 *   [Search]  [Period ▾]  [Filter N]  [Group by ▾]     ml-auto: [actions slot]
 *   [active filter pills + Clear]                      (only while filtering)
 *
 * The period (date range) is a first-class one-click control — the most
 * common workflow ("show me last month, export it") shouldn't hide behind
 * a popover. Member / category / billing status use the shared Notion-style
 * "+ Filter" engine from the tasks page.
 */
export function ProjectTimeFilters({
  availableMembers,
  categories,
  actions,
}: {
  availableMembers: Member[]
  categories: Doc<"workCategories">[] | undefined
  /** Right-aligned action buttons (Worksheet, Invoice Unbilled Hours, Add Time). */
  actions?: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Default grouping is "task" — must match `parseGrouping` in
  // `project-time-content.tsx`, which treats a missing param as task.
  const activeGroupBy = searchParams.get("groupBy") ?? "task"
  const activeDateRange = parseDateRangePreset(searchParams.get("dateRange"))
  const customFrom = searchParams.get("from") ?? undefined
  const customTo = searchParams.get("to") ?? undefined

  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

  const setParams = useCallback(
    (updates: Array<[string, string | undefined]>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of updates) {
        if (!value) {
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

  const handleDateRangeChange = useCallback(
    (value: string) => {
      const next = value as DateRangePreset
      if (next === DEFAULT_TIME_DATE_RANGE) {
        // The default — drop the param entirely so links stay clean.
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

  const hasInvalidCustomRange =
    activeDateRange === "custom" &&
    !!customFrom &&
    !!customTo &&
    customTo < customFrom

  return (
    <div className="flex flex-col gap-2">
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

        <Select value={activeDateRange} onValueChange={handleDateRangeChange}>
          <SelectTrigger size="sm" className="w-[150px]" aria-label="Date range">
            <span className="flex items-center gap-2">
              <CalendarIcon aria-hidden className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder="Date range" />
            </span>
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

        {activeDateRange === "custom" && (
          <div className="flex items-center gap-1.5">
            <DatePicker
              value={parseYMDToLocalDate(customFrom)}
              onChange={handleCustomFromChange}
              placeholder="Start"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <DatePicker
              value={parseYMDToLocalDate(customTo)}
              onChange={handleCustomToChange}
              placeholder="End"
              aria-invalid={hasInvalidCustomRange}
            />
          </div>
        )}

        <ProjectTimeFilterButton
          availableMembers={availableMembers}
          categories={categories}
        />

        <Select
          value={activeGroupBy}
          onValueChange={(v) => {
            setParam("groupBy", v === "task" ? undefined : v)
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

        {actions && (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </div>

      <ProjectTimeActiveFilters
        availableMembers={availableMembers}
        categories={categories}
      />
    </div>
  )
}
