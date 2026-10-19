"use client"

/**
 * Notion-style "+ Filter" for the project Time tab — same engine as the
 * tasks page (`components/ui/filters.tsx`), composed with time-entry
 * facets: Member, Category, Billing status.
 *
 * Two exports, mirroring `tasks-filter-bar.tsx`:
 *   - `ProjectTimeFilterButton` — the trigger + two-step add-filter command
 *     (pick facet → pick value), lives in the toolbar row.
 *   - `ProjectTimeActiveFilters` — the editable pills + Clear, rendered in
 *     a second row only while filters are active.
 *
 * Filter state lives in the URL (`useProjectTimeFilters`); the actual row
 * filtering is client-side (`applyTimeEntryFilters`).
 */

import { useMemo, useState } from "react"
import { nanoid } from "nanoid"
import { CircleDashed, ListFilter, Tag, UserCircle } from "lucide-react"
import type { Doc } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import Filters, {
  AnimateChangeInHeight,
  FilterOperator,
  type Filter,
  type FilterOption,
  type FilterTypeConfig,
} from "@/components/ui/filters"
import { getCategoryColor } from "@/convex/lib/constants"
import { useProjectTimeFilters } from "@/lib/hooks/use-project-time-filters"
import { TIME_ENTRY_FACETS, type TimeEntryFacet } from "@/lib/time-entry-filters"

type Member = {
  id: string
  name: string
  imageUrl: string | undefined
}

// Matches `entryStatus()` vocabulary — same options the old select offered.
const STATUS_OPTIONS: FilterOption[] = [
  { id: "open", name: "Open" },
  { id: "draft", name: "Draft" },
  { id: "closed", name: "Closed" },
  { id: "non_billable", name: "Non-billable" },
]

function useTimeEntryFilterConfigs(
  availableMembers: Member[],
  categories: Doc<"workCategories">[] | undefined,
  facets: readonly TimeEntryFacet[],
): FilterTypeConfig[] {
  return useMemo(() => {
    const memberOptions: FilterOption[] = availableMembers.map((m) => ({
      id: m.id,
      name: m.name,
      icon: <UserCircle className="size-3.5 text-muted-foreground" />,
    }))

    const categoryOptions: FilterOption[] = (categories ?? []).map((c) => {
      const color = getCategoryColor(c.color)
      return {
        id: c._id,
        name: c.name,
        icon: (
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color.dot }}
          />
        ),
      }
    })

    const all: Array<FilterTypeConfig & { key: TimeEntryFacet }> = [
      {
        key: "member",
        label: "Member",
        icon: <UserCircle className="size-3.5" />,
        options: memberOptions,
      },
      {
        key: "category",
        label: "Category",
        icon: <Tag className="size-3.5" />,
        options: categoryOptions,
      },
      {
        key: "status",
        label: "Billing status",
        icon: <CircleDashed className="size-3.5" />,
        options: STATUS_OPTIONS,
      },
    ]
    return all.filter((config) => facets.includes(config.key))
  }, [availableMembers, categories, facets])
}

export function ProjectTimeFilterButton({
  availableMembers,
  categories,
  facets = TIME_ENTRY_FACETS,
}: {
  availableMembers: Member[]
  categories: Doc<"workCategories">[] | undefined
  /** Facets offered in the picker — the close ledger omits `status`. */
  facets?: readonly TimeEntryFacet[]
}) {
  const { filters, setFilters } = useProjectTimeFilters()
  const configs = useTimeEntryFilterConfigs(availableMembers, categories, facets)
  const [open, setOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [commandInput, setCommandInput] = useState("")

  const activeCount = filters.filter((f) => f.value.length > 0).length
  const selectedConfig = selectedType
    ? configs.find((t) => t.key === selectedType)
    : undefined

  function addFilter(type: string, optionId: string) {
    setFilters((prev) => [
      ...prev,
      {
        id: nanoid(),
        type,
        operator: FilterOperator.IS,
        value: [optionId],
      },
    ])
    setOpen(false)
    setTimeout(() => {
      setSelectedType(null)
      setCommandInput("")
    }, 200)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setTimeout(() => {
            setSelectedType(null)
            setCommandInput("")
          }, 200)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Filter"
          className="h-9 gap-2"
        >
          <ListFilter aria-hidden className="size-3.5" />
          Filter
          {activeCount > 0 && (
            <Badge
              className="ml-1 min-w-5 rounded-full tabular-nums"
              aria-label={`${activeCount} active filters`}
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder={selectedConfig ? selectedConfig.label : "Filter..."}
              className="h-9"
              value={commandInput}
              onInputCapture={(e) => setCommandInput(e.currentTarget.value)}
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              {selectedType ? (
                <CommandGroup>
                  {(selectedConfig?.options ?? []).map((option) => (
                    <CommandItem
                      className="group flex items-center gap-2 text-muted-foreground"
                      key={option.id}
                      value={option.id}
                      keywords={[option.name]}
                      onSelect={() => addFilter(selectedType, option.id)}
                    >
                      {option.icon}
                      <span className="text-accent-foreground">
                        {option.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <CommandGroup>
                  {configs.map((config) => (
                    <CommandItem
                      className="group flex items-center gap-2 text-muted-foreground"
                      key={config.key}
                      value={config.label}
                      onSelect={() => {
                        setSelectedType(config.key)
                        setCommandInput("")
                      }}
                    >
                      {config.icon}
                      <span className="text-accent-foreground">
                        {config.label}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  )
}

export function ProjectTimeActiveFilters({
  availableMembers,
  categories,
  facets = TIME_ENTRY_FACETS,
}: {
  availableMembers: Member[]
  categories: Doc<"workCategories">[] | undefined
  /** Must match the button's facet set so pills render for every active facet. */
  facets?: readonly TimeEntryFacet[]
}) {
  const { filters, setFilters } = useProjectTimeFilters()
  const configs = useTimeEntryFilterConfigs(availableMembers, categories, facets)

  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filters filters={filters} setFilters={setFilters} typeConfigs={configs} />
      <Button
        variant="outline"
        size="sm"
        className="h-6 rounded-md border-border bg-background text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        onClick={() => setFilters([])}
      >
        Clear
      </Button>
    </div>
  )
}

export type { Filter }
