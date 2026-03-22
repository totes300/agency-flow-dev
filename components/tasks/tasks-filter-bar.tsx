"use client"

import { useMemo, useState } from "react"
import { nanoid } from "nanoid"
import {
  ListFilter,
  CircleDashed,
  FolderKanban,
  Tag,
  UserCircle,
  Building2,
  CalendarDays,
} from "lucide-react"
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
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { getStatusColor } from "@/lib/status-colors"
import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

function useFilterTypeConfigs(isAdmin?: boolean): FilterTypeConfig[] {
  const { statuses, categories, projects, orgMembers } = useTaskReferenceData()

  return useMemo(() => {
    const statusOptions: FilterOption[] = (statuses ?? []).map((s) => {
      const color = getStatusColor(s.color)
      return {
        id: s._id,
        name: s.name,
        icon: <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color.dot }} />,
      }
    })

    const projectOptions: FilterOption[] = (projects ?? []).map((p) => ({
      id: p._id,
      name: p.name,
      group: p.clientName,
      icon: <FolderKanban className="size-3.5 text-muted-foreground" />,
    }))

    const categoryOptions: FilterOption[] = (categories ?? []).map((c) => {
      const color = getCategoryColor(c.color)
      return {
        id: c._id,
        name: c.name,
        icon: <span className="h-4 w-5 shrink-0 rounded" style={{ backgroundColor: color.bg, boxShadow: `inset 0 0 0 1px ${color.ring}` }} />,
      }
    })

    const assigneeOptions: FilterOption[] = (orgMembers ?? []).map((m) => ({
      id: m._id,
      name: m.name,
      icon: <UserCircle className="size-3.5 text-muted-foreground" />,
    }))

    // Derive unique clients from projects
    const clientMap = new Map<string, { id: string; name: string }>()
    for (const p of projects ?? []) {
      if (p.clientId && !clientMap.has(p.clientId)) {
        clientMap.set(p.clientId, { id: p.clientId, name: p.clientName })
      }
    }
    const clientOptions: FilterOption[] = Array.from(clientMap.values()).map((c) => ({
      id: c.id,
      name: c.name,
      icon: <Building2 className="size-3.5 text-muted-foreground" />,
    }))

    const configs: FilterTypeConfig[] = [
      {
        key: "status",
        label: "Status",
        icon: <CircleDashed className="size-3.5" />,
        options: statusOptions,
      },
      {
        key: "project",
        label: "Project",
        icon: <FolderKanban className="size-3.5" />,
        options: projectOptions,
        popoverWidth: "280px",
      },
      {
        key: "category",
        label: "Category",
        icon: <Tag className="size-3.5" />,
        options: categoryOptions,
      },
      {
        key: "assignee",
        label: "Assignee",
        icon: <UserCircle className="size-3.5" />,
        options: assigneeOptions,
      },
      {
        key: "client",
        label: "Client",
        icon: <Building2 className="size-3.5" />,
        options: clientOptions,
        adminOnly: true,
      },
      {
        key: "dueDate",
        label: "Due Date",
        icon: <CalendarDays className="size-3.5" />,
        options: [],
        isDateRange: true,
        operators: () => [FilterOperator.IS],
      },
    ]

    // Filter out admin-only configs when user is not admin
    return isAdmin === false ? configs.filter((c) => !c.adminOnly) : configs
  }, [statuses, categories, projects, orgMembers, isAdmin])
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
        className="group text-muted-foreground flex gap-2 items-center"
        key={filter.id}
        value={filter.id}
        keywords={[filter.name, filter.group ?? ""]}
        onSelect={() => onSelect(filter)}
      >
        {filter.icon}
        <span className="text-accent-foreground">
          {filter.name}
        </span>
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

  return (
    <CommandGroup>
      {options.map(renderItem)}
    </CommandGroup>
  )
}

// ─── Filter trigger (popover to add filters) — lives in tab bar row 1 ────────

export function TasksFilterBar({
  filters,
  setFilters,
  isAdmin,
}: {
  filters: Filter[]
  setFilters: React.Dispatch<React.SetStateAction<Filter[]>>
  isAdmin?: boolean
}) {
  const configs = useFilterTypeConfigs(isAdmin)
  const [open, setOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [commandInput, setCommandInput] = useState("")

  const hasActiveFilters = filters.some((f) => f.value?.length > 0)

  return (
    <div className="flex gap-2 items-center">
      <Popover
        open={open}
        onOpenChange={(open) => {
          setOpen(open)
          if (!open) {
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
              "transition group h-8 text-xs items-center rounded-sm flex gap-1.5",
              hasActiveFilters
                ? "bg-blue-500/10 text-blue-600 hover:bg-blue-500/15 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400"
                : "text-muted-foreground",
            )}
          >
            <ListFilter className={cn(
              "size-3 shrink-0 transition-all",
              !hasActiveFilters && "group-hover:text-primary",
            )} />
            {hasActiveFilters ? (
              <span>{filters.filter((f) => f.value?.length > 0).length}</span>
            ) : (
              "Filter"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" style={{ width: selectedType ? (configs.find((t) => t.key === selectedType)?.popoverWidth ?? "200px") : "200px" }}>
          <AnimateChangeInHeight>
            <Command>
              <CommandInput
                placeholder={selectedType ? configs.find((t) => t.key === selectedType)?.label ?? "Filter..." : "Filter..."}
                className="h-9"
                value={commandInput}
                onInputCapture={(e) => {
                  setCommandInput(e.currentTarget.value)
                }}
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
                      setTimeout(() => {
                        setSelectedType(null)
                        setCommandInput("")
                      }, 200)
                      setOpen(false)
                    }}
                  />
                ) : (
                  <CommandGroup>
                    {configs
                      .filter((config) => {
                        // Hide date range filter if already active (only one allowed)
                        if (config.isDateRange) {
                          return !filters.some((f) => f.type === config.key)
                        }
                        return true
                      })
                      .map((config) => (
                      <CommandItem
                        className="group text-muted-foreground flex gap-2 items-center"
                        key={config.key}
                        value={config.label}
                        onSelect={() => {
                          if (config.isDateRange) {
                            // Date range filters are added immediately with empty placeholder values
                            setFilters((prev) => [
                              ...prev,
                              {
                                id: nanoid(),
                                type: config.key,
                                operator: FilterOperator.IS,
                                value: ["", ""], // [from, to] — empty strings until user picks dates
                              },
                            ])
                            setOpen(false)
                            setTimeout(() => {
                              setSelectedType(null)
                              setCommandInput("")
                            }, 200)
                            return
                          }
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
    </div>
  )
}

// ─── Active filter pills — lives in tab bar row 2 ───────────────────────────

export function TasksActiveFilters({
  filters,
  setFilters,
  isAdmin,
}: {
  filters: Filter[]
  setFilters: React.Dispatch<React.SetStateAction<Filter[]>>
  isAdmin?: boolean
}) {
  const configs = useFilterTypeConfigs(isAdmin)

  return (
    <>
      <Filters filters={filters} setFilters={setFilters} typeConfigs={configs} />

      <Button
        variant="outline"
        size="sm"
        className="transition group h-6 text-xs items-center rounded-sm"
        onClick={() => setFilters([])}
      >
        Clear
      </Button>
    </>
  )
}
