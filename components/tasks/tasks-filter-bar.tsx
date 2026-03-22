"use client"

import { useMemo, useState } from "react"
import { nanoid } from "nanoid"
import {
  ListFilter,
  CircleDashed,
  FolderKanban,
  Tag,
  UserCircle,
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

function useFilterTypeConfigs(): FilterTypeConfig[] {
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

    return [
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
    ]
  }, [statuses, categories, projects, orgMembers])
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

// ─── Exported filter bar ─────────────────────────────────────────────────────

export function TasksFilterBar({
  filters,
  setFilters,
}: {
  filters: Filter[]
  setFilters: React.Dispatch<React.SetStateAction<Filter[]>>
}) {
  const configs = useFilterTypeConfigs()
  const [open, setOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [commandInput, setCommandInput] = useState("")

  return (
    <div className="flex gap-2 flex-wrap items-center">
      <Filters filters={filters} setFilters={setFilters} typeConfigs={configs} />

      {filters.filter((f) => f.value?.length > 0).length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="transition group h-6 text-xs items-center rounded-sm"
          onClick={() => setFilters([])}
        >
          Clear
        </Button>
      )}

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
              "transition group h-6 text-xs items-center rounded-sm flex gap-1.5",
              filters.length > 0 && "w-6"
            )}
          >
            <ListFilter className="size-3 shrink-0 transition-all text-muted-foreground group-hover:text-primary" />
            {!filters.length && "Filter"}
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
                    {configs.map((config) => (
                      <CommandItem
                        className="group text-muted-foreground flex gap-2 items-center"
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
    </div>
  )
}
