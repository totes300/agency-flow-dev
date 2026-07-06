"use client"

import { useMemo, useState } from "react"
import {
  Building2Icon,
  CalendarCheckIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FolderIcon,
  PlusIcon,
  TagIcon,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { getCategoryColor } from "@/convex/lib/constants"
import type { TaskPanelItem } from "@/convex/planner"
import { cn } from "@/lib/utils"
import {
  anyPanelFilterActive,
  derivePanelFacets,
  type PanelFacetOption,
  type PlannerDueFilter,
  type PlannerPanelFilters,
  type PlannerScheduleFilter,
} from "@/lib/planner"

type PropertyKey = "schedule" | "project" | "client" | "category" | "due"

const PROPERTIES: ReadonlyArray<{
  key: PropertyKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { key: "schedule", label: "Schedule", icon: CalendarCheckIcon },
  { key: "project", label: "Project", icon: FolderIcon },
  { key: "client", label: "Client", icon: Building2Icon },
  { key: "category", label: "Category", icon: TagIcon },
  { key: "due", label: "Due date", icon: CalendarIcon },
]

const DUE_OPTIONS: ReadonlyArray<readonly [Exclude<PlannerDueFilter, "all">, string]> = [
  ["overdue", "Overdue"],
  ["week", "Due in 7 days"],
  ["none", "No due date"],
]

const SCHEDULE_OPTIONS: ReadonlyArray<
  readonly [Exclude<PlannerScheduleFilter, "all">, string]
> = [
  ["unscheduled", "Unscheduled"],
  ["planned", "Planned"],
]

/** Show a search input once a value list is long enough to need one. */
const SEARCHABLE_FROM = 8

function selectionOf(filters: PlannerPanelFilters, p: PropertyKey): string[] {
  switch (p) {
    case "project": return filters.projectIds
    case "client": return filters.clientIds
    case "category": return filters.categoryKeys
    case "due": return filters.due === "all" ? [] : [filters.due]
    case "schedule": return filters.schedule === "all" ? [] : [filters.schedule]
  }
}

/**
 * Notion-style panel filters: an idle "+ Filter" affordance opens a
 * two-step popover (pick a property, then pick values); each active filter
 * renders as a compact chip (`Client: Arlow`, `Project: 2`) that reopens
 * its value menu directly. Value lists are FACETED — computed from the
 * tasks passing every other active chip, with match counts — so picking a
 * client narrows the project menu to that client's projects. Panel-scoped:
 * the timeline never sees these filters.
 */
export function PlannerPanelFilters({
  tasks,
  filters,
  onChange,
  onClear,
  todayYmd,
}: {
  /** Tasks already narrowed to the active tab (facet + count source). */
  tasks: TaskPanelItem[]
  filters: PlannerPanelFilters
  onChange: (patch: Partial<PlannerPanelFilters>) => void
  onClear: () => void
  todayYmd: string
}) {
  const facets = useMemo(
    () => derivePanelFacets(tasks, filters, todayYmd),
    [tasks, filters, todayYmd],
  )

  const activeProperties = PROPERTIES.filter(
    (p) => selectionOf(filters, p.key).length > 0,
  )
  const inactiveProperties = PROPERTIES.filter(
    (p) => selectionOf(filters, p.key).length === 0,
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-2.5">
      {activeProperties.map((p) => (
        <FilterChip
          key={p.key}
          property={p.key}
          filters={filters}
          facets={facets}
          onChange={onChange}
        />
      ))}

      {inactiveProperties.length > 0 ? (
        <AddFilterButton
          properties={inactiveProperties}
          filters={filters}
          facets={facets}
          onChange={onChange}
        />
      ) : null}

      {/* Clear only once the view differs from the default inbox — the
          pre-applied Schedule chip alone is not "something to clear". */}
      {anyPanelFilterActive({ ...filters, schedule: "all" }) ||
      filters.schedule === "planned" ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-1.5 py-[3px] text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}

// ── "+ Filter" — two-step popover: property, then values ────────────────────

function AddFilterButton({
  properties,
  filters,
  facets,
  onChange,
}: {
  properties: ReadonlyArray<(typeof PROPERTIES)[number]>
  filters: PlannerPanelFilters
  facets: ReturnType<typeof derivePanelFacets>
  onChange: (patch: Partial<PlannerPanelFilters>) => void
}) {
  const [open, setOpen] = useState(false)
  const [property, setProperty] = useState<PropertyKey | null>(null)
  const [search, setSearch] = useState("")

  const reset = () => {
    setProperty(null)
    setSearch("")
  }

  // The ONLY way this popover ever closes: programmatic closes (single-select
  // picks) bypass Radix's onOpenChange, so close and reset must travel
  // together — a stale `property` would otherwise reopen "+ Filter" straight
  // on the last value list forever.
  const close = () => {
    setOpen(false)
    reset()
  }

  const visibleProperties = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return properties
    return properties.filter((p) => p.label.toLowerCase().includes(q))
  }, [properties, search])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else close()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full px-2 py-[3px] text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PlusIcon className="size-3" />
          Filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[236px] p-0">
        {property === null ? (
          <>
            <div className="border-b border-border p-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by…"
                className="h-7 text-[12.5px]"
                autoFocus
              />
            </div>
            <div className="p-1">
              {visibleProperties.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setProperty(p.key)
                    setSearch("")
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-muted/60"
                >
                  <p.icon className="size-3.5 text-muted-foreground" />
                  {p.label}
                </button>
              ))}
              {visibleProperties.length === 0 ? (
                <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                  No matches
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <FacetValueList
            key={property}
            property={property}
            filters={filters}
            facets={facets}
            onChange={onChange}
            onSingleSelectDone={close}
            onBack={reset}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

// ── Active chip — reopens its value menu directly ────────────────────────────

function FilterChip({
  property,
  filters,
  facets,
  onChange,
}: {
  property: PropertyKey
  filters: PlannerPanelFilters
  facets: ReturnType<typeof derivePanelFacets>
  onChange: (patch: Partial<PlannerPanelFilters>) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = PROPERTIES.find((p) => p.key === property)!
  const selection = selectionOf(filters, property)

  let value: string
  if (property === "due") {
    value = DUE_OPTIONS.find(([v]) => v === filters.due)?.[1] ?? ""
  } else if (property === "schedule") {
    value = SCHEDULE_OPTIONS.find(([v]) => v === filters.schedule)?.[1] ?? ""
  } else if (selection.length === 1) {
    const options =
      property === "project"
        ? facets.project
        : property === "client"
          ? facets.client
          : facets.category
    value = options.find((o) => o.key === selection[0])?.label ?? "1"
  } else {
    value = String(selection.length)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex max-w-[190px] items-center gap-1 rounded-full bg-muted/70 px-2.5 py-[3px] text-[11.5px] transition-colors hover:bg-muted"
        >
          <span className="flex-none text-muted-foreground">{meta.label}:</span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {value}
          </span>
          <ChevronDownIcon className="size-3 flex-none text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[236px] p-0">
        <FacetValueList
          property={property}
          filters={filters}
          facets={facets}
          onChange={onChange}
          onSingleSelectDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

// ── Shared value list (checkboxes / due radio + counts + clear) ──────────────

function FacetValueList({
  property,
  filters,
  facets,
  onChange,
  onSingleSelectDone,
  onBack,
}: {
  property: PropertyKey
  filters: PlannerPanelFilters
  facets: ReturnType<typeof derivePanelFacets>
  onChange: (patch: Partial<PlannerPanelFilters>) => void
  /** Close the popover after a single-select choice (Due / Schedule). */
  onSingleSelectDone: () => void
  /** "+ Filter" flow only: step back to the property picker. */
  onBack?: () => void
}) {
  const [search, setSearch] = useState("")

  const meta = PROPERTIES.find((p) => p.key === property)!
  const header = onBack ? (
    <button
      type="button"
      onClick={onBack}
      className="flex w-full items-center gap-1.5 border-b border-border px-2.5 py-2 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeftIcon className="size-3.5" />
      {meta.label}
    </button>
  ) : null

  if (property === "due" || property === "schedule") {
    const rows =
      property === "due"
        ? DUE_OPTIONS.map(([option, label]) => ({
            label,
            count: facets.due[option],
            active: filters.due === option,
            select: () => onChange({ due: filters.due === option ? "all" : option }),
          }))
        : SCHEDULE_OPTIONS.map(([option, label]) => ({
            label,
            count: facets.schedule[option],
            active: filters.schedule === option,
            select: () =>
              onChange({ schedule: filters.schedule === option ? "all" : option }),
          }))
    return (
      <>
      {header}
      <div className="p-1">
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            onClick={() => {
              row.select()
              onSingleSelectDone()
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {row.count}
            </span>
            <CheckIcon
              className={cn("size-3.5 flex-none", !row.active && "invisible")}
            />
          </button>
        ))}
      </div>
      </>
    )
  }

  const options =
    property === "project"
      ? facets.project
      : property === "client"
        ? facets.client
        : facets.category
  const selection = selectionOf(filters, property)
  const patchKey =
    property === "project"
      ? "projectIds"
      : property === "client"
        ? "clientIds"
        : "categoryKeys"

  const q = search.trim().toLowerCase()
  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options

  const toggle = (key: string) => {
    const next = selection.includes(key)
      ? selection.filter((k) => k !== key)
      : [...selection, key]
    onChange({ [patchKey]: next })
  }

  return (
    <>
      {header}
      {options.length >= SEARCHABLE_FROM ? (
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-7 text-[12.5px]"
            autoFocus
          />
        </div>
      ) : null}

      <div className="max-h-[240px] overflow-y-auto p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
            No matches
          </p>
        ) : (
          visible.map((o) => (
            <FacetRow
              key={o.key}
              option={o}
              checked={selection.includes(o.key)}
              showDot={property === "category"}
              onToggle={() => toggle(o.key)}
            />
          ))
        )}
      </div>

      {selection.length > 0 ? (
        <div className="border-t border-border p-1">
          <button
            type="button"
            onClick={() => onChange({ [patchKey]: [] })}
            className="w-full rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      ) : null}
    </>
  )
}

function FacetRow({
  option,
  checked,
  showDot,
  onToggle,
}: {
  option: PanelFacetOption
  checked: boolean
  showDot: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-muted/60"
    >
      <Checkbox checked={checked} className="pointer-events-none" />
      {showDot ? (
        <span
          aria-hidden
          className="size-2 flex-none rounded-full"
          style={{
            backgroundColor: getCategoryColor(option.color ?? "gray").dot,
          }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {option.count}
      </span>
    </button>
  )
}
