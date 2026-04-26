"use client"

import { useMemo, useState } from "react"
import { nanoid } from "nanoid"
import {
  ListFilter,
  FolderKanban,
  Building2,
  CalendarDays,
  CalendarClock,
} from "lucide-react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
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
  groupOptionsByGroup,
  type Filter,
  type FilterTypeConfig,
  type FilterOption,
} from "@/components/ui/filters"
import { cn } from "@/lib/utils"

// ─── Filter type configs ────────────────────────────────────────────────────
//
// Mirrors `components/tasks/tasks-filter-bar.tsx` so both pages read as one
// system. Invoice-scoped subset: client, project, issue date, due date.

function useFilterTypeConfigs(): FilterTypeConfig[] {
  const { isAuthenticated } = useConvexAuth()
  const clients = useQuery(api.clients.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")

  return useMemo(() => {
    const clientOptions: FilterOption[] = (clients ?? []).map((c) => ({
      id: c._id,
      name: c.name,
      icon: <Building2 className="size-3.5 text-muted-foreground" />,
    }))

    // Projects are grouped by client name so "Acme Corp ▸ Website" and
    // "Beacon Co. ▸ Rebrand" don't read as peers in a flat list.
    const clientNameById = new Map<string, string>()
    for (const c of clients ?? []) clientNameById.set(c._id, c.name)
    const projectOptions: FilterOption[] = (projects ?? []).map((p) => ({
      id: p._id,
      name: p.name,
      group: p.clientName ?? clientNameById.get(p.clientId) ?? "Unknown client",
      icon: <FolderKanban className="size-3.5 text-muted-foreground" />,
    }))

    return [
      {
        key: "client",
        label: "Client",
        icon: <Building2 className="size-3.5" />,
        options: clientOptions,
      },
      {
        key: "project",
        label: "Project",
        icon: <FolderKanban className="size-3.5" />,
        options: projectOptions,
        popoverWidth: "280px",
      },
      {
        key: "issueDate",
        label: "Issue date",
        icon: <CalendarDays className="size-3.5" />,
        options: [],
        isDateRange: true,
        operators: () => [FilterOperator.IS],
      },
      {
        key: "dueDate",
        label: "Due date",
        icon: <CalendarClock className="size-3.5" />,
        options: [],
        isDateRange: true,
        operators: () => [FilterOperator.IS],
      },
    ]
  }, [clients, projects])
}

// ─── Options list (supports grouped rendering) ──────────────────────────────

function OptionsList({
  configs,
  selectedType,
  onSelect,
}: {
  configs: FilterTypeConfig[]
  selectedType: string
  onSelect: (filter: FilterOption) => void
}) {
  const config = configs.find((t) => t.key === selectedType)
  const options = config?.options ?? []
  const hasGroups = options.some((o) => o.group)

  function renderItem(filter: FilterOption) {
    return (
      <CommandItem
        key={filter.id}
        value={filter.id}
        keywords={[filter.name, filter.group ?? ""]}
        onSelect={() => onSelect(filter)}
        className="group flex items-center gap-2 text-muted-foreground"
      >
        {filter.icon}
        <span className="text-accent-foreground">{filter.name}</span>
      </CommandItem>
    )
  }

  if (hasGroups) {
    return (
      <>
        {groupOptionsByGroup(options).map(({ group, items }, i) => (
          <CommandGroup key={group ?? i} heading={group}>
            {items.map(renderItem)}
          </CommandGroup>
        ))}
      </>
    )
  }

  return <CommandGroup>{options.map(renderItem)}</CommandGroup>
}

// ─── Filter trigger (popover to add filters) ────────────────────────────────

export function InvoicesFilterBar({
  filters,
  setFilters,
}: {
  filters: Filter[]
  setFilters: (updater: Filter[] | ((prev: Filter[]) => Filter[])) => void
}) {
  const configs = useFilterTypeConfigs()
  const [open, setOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [commandInput, setCommandInput] = useState("")

  const hasActiveFilters = filters.some((f) => f.value?.length > 0)

  function closeAndReset() {
    setOpen(false)
    // Defer so the popover close animation doesn't show a flicker of reset state.
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
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          size="sm"
          className={cn(
            "group flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs transition-colors",
            hasActiveFilters
              ? "border-primary/15 bg-primary/8 text-primary/70 hover:border-primary/20 hover:bg-primary/12 hover:text-primary/80"
              : "text-muted-foreground/85 hover:border-border/80 hover:bg-muted/55 hover:text-foreground",
          )}
        >
          <ListFilter className="size-3 shrink-0" />
          {hasActiveFilters
            ? filters.filter((f) => f.value?.length > 0).length
            : "Filter"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{
          width: selectedType
            ? (configs.find((t) => t.key === selectedType)?.popoverWidth ?? "200px")
            : "200px",
        }}
      >
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder={
                selectedType
                  ? (configs.find((t) => t.key === selectedType)?.label ?? "Filter...")
                  : "Filter..."
              }
              className="h-9"
              value={commandInput}
              onInputCapture={(e) => setCommandInput(e.currentTarget.value)}
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              {selectedType ? (
                <OptionsList
                  configs={configs}
                  selectedType={selectedType}
                  onSelect={(filter) => {
                    setFilters((prev) => [
                      ...prev,
                      {
                        id: nanoid(),
                        type: selectedType,
                        operator: FilterOperator.IS,
                        value: [filter.id],
                      },
                    ])
                    closeAndReset()
                  }}
                />
              ) : (
                <CommandGroup>
                  {configs
                    .filter((config) => {
                      // One date range per field at a time.
                      if (config.isDateRange) {
                        return !filters.some((f) => f.type === config.key)
                      }
                      return true
                    })
                    .map((config) => (
                      <CommandItem
                        key={config.key}
                        value={config.label}
                        onSelect={() => {
                          if (config.isDateRange) {
                            // Materialize immediately with empty strings so the
                            // inline date inputs render; user picks dates next.
                            setFilters((prev) => [
                              ...prev,
                              {
                                id: nanoid(),
                                type: config.key,
                                operator: FilterOperator.IS,
                                value: ["", ""],
                              },
                            ])
                            closeAndReset()
                            return
                          }
                          setSelectedType(config.key)
                          setCommandInput("")
                        }}
                        className="group flex items-center gap-2 text-muted-foreground"
                      >
                        {config.icon}
                        <span className="text-accent-foreground">{config.label}</span>
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

// ─── Active filter pills ────────────────────────────────────────────────────

export function InvoicesActiveFilters({
  filters,
  setFilters,
}: {
  filters: Filter[]
  setFilters: (updater: Filter[] | ((prev: Filter[]) => Filter[])) => void
}) {
  const configs = useFilterTypeConfigs()
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
