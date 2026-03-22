"use client"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import { Dispatch, SetStateAction, useRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AnimatePresence, motion } from "motion/react"

// ─── Animate height helper ───────────────────────────────────────────────────

interface AnimateChangeInHeightProps {
  children: React.ReactNode
  className?: string
}

export const AnimateChangeInHeight: React.FC<AnimateChangeInHeightProps> = ({
  children,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | "auto">("auto")

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        const observedHeight = entries[0].contentRect.height
        setHeight(observedHeight)
      })

      resizeObserver.observe(containerRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [])

  return (
    <motion.div
      className={cn(className, "overflow-hidden")}
      style={{ height }}
      animate={{ height }}
      transition={{ duration: 0.1, damping: 0.2, ease: "easeIn" }}
    >
      <div ref={containerRef}>{children}</div>
    </motion.div>
  )
}

// ─── Generic types (re-exported from lib for colocation with UI) ─────────────

export {
  FilterOperator,
  type FilterOption,
  type FilterTypeConfig,
  type Filter,
} from "@/lib/filter-types"
import { FilterOperator, type FilterOption, type FilterTypeConfig, type Filter } from "@/lib/filter-types"

// ─── Default operator logic ──────────────────────────────────────────────────

function defaultOperators(values: string[]): FilterOperator[] {
  if (Array.isArray(values) && values.length > 1) {
    return [FilterOperator.IS_ANY_OF, FilterOperator.IS_NOT]
  }
  return [FilterOperator.IS, FilterOperator.IS_NOT]
}

// ─── Operator dropdown ───────────────────────────────────────────────────────

const FilterOperatorDropdown = ({
  filterType,
  operator,
  filterValues,
  setOperator,
  typeConfigs,
}: {
  filterType: string
  operator: FilterOperator
  filterValues: string[]
  setOperator: (operator: FilterOperator) => void
  typeConfigs: FilterTypeConfig[]
}) => {
  const config = typeConfigs.find((t) => t.key === filterType)
  const getOperators = config?.operators ?? defaultOperators
  const operators = getOperators(filterValues)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-muted hover:bg-muted/50 px-1.5 py-1 text-muted-foreground hover:text-primary transition shrink-0">
        {operator}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-fit min-w-fit">
        {operators.map((op) => (
          <DropdownMenuItem key={op} onClick={() => setOperator(op)}>
            {op}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function groupOptionsByGroup(options: FilterOption[]): { group: string | undefined; items: FilterOption[] }[] {
  const groups: { group: string | undefined; items: FilterOption[] }[] = []
  const map = new Map<string | undefined, FilterOption[]>()
  const order: (string | undefined)[] = []
  for (const opt of options) {
    const key = opt.group
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(opt)
  }
  for (const key of order) {
    groups.push({ group: key, items: map.get(key)! })
  }
  return groups
}

function renderOptionItem(
  filter: FilterOption,
  checked: boolean,
  onSelect: () => void,
) {
  return (
    <CommandItem
      className="group flex gap-2 items-center"
      key={filter.id}
      value={filter.id}
      keywords={[filter.name, filter.group ?? ""]}
      onSelect={onSelect}
    >
      <Checkbox
        checked={checked}
        className={cn(!checked && "opacity-0 group-data-[selected=true]:opacity-100")}
      />
      {filter.icon}
      <span className="text-accent-foreground">
        {filter.name}
      </span>
    </CommandItem>
  )
}

// ─── Value combobox ──────────────────────────────────────────────────────────

const FilterValueCombobox = ({
  filterType,
  filterValues,
  setFilterValues,
  typeConfigs,
}: {
  filterType: string
  filterValues: string[] // stores IDs
  setFilterValues: (filterValues: string[]) => void
  typeConfigs: FilterTypeConfig[]
}) => {
  const [open, setOpen] = useState(false)
  const [commandInput, setCommandInput] = useState("")
  const commandInputRef = useRef<HTMLInputElement>(null)

  const config = typeConfigs.find((t) => t.key === filterType)
  const allOptions = config?.options ?? []
  const hasGroups = allOptions.some((o) => o.group)
  const popoverWidth = config?.popoverWidth ?? "200px"
  const findOpt = (id: string) => allOptions.find((o) => o.id === id)

  const nonSelectedOptions = allOptions.filter(
    (opt) => !filterValues.includes(opt.id)
  )

  function handleSelect(id: string) {
    setFilterValues([...filterValues, id])
    setTimeout(() => setCommandInput(""), 200)
    setOpen(false)
  }

  function handleDeselect(id: string) {
    setFilterValues(filterValues.filter((v) => v !== id))
    setTimeout(() => setCommandInput(""), 200)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open)
        if (!open) {
          setTimeout(() => setCommandInput(""), 200)
        }
      }}
    >
      <PopoverTrigger
        className="rounded-none px-1.5 py-1 bg-muted hover:bg-muted/50 transition
  text-muted-foreground hover:text-primary shrink-0"
      >
        <div className="flex gap-1.5 items-center">
          {findOpt(filterValues[0])?.icon}
          {filterValues?.length === 1
            ? (findOpt(filterValues[0])?.name ?? filterValues[0])
            : `${filterValues?.length} selected`}
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: popoverWidth }}>
        <AnimateChangeInHeight>
          <Command>
            <CommandInput
              placeholder={config?.label ?? filterType}
              className="h-9"
              value={commandInput}
              onInputCapture={(e) => {
                setCommandInput(e.currentTarget.value)
              }}
              ref={commandInputRef}
            />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              {/* Selected items */}
              {filterValues.length > 0 && (
                <CommandGroup>
                  {filterValues.map((id) => {
                    const opt = findOpt(id)
                    return renderOptionItem(
                      opt ?? { id, name: id },
                      true,
                      () => handleDeselect(id),
                    )
                  })}
                </CommandGroup>
              )}
              {/* Non-selected items — grouped or flat */}
              {nonSelectedOptions.length > 0 && (
                <>
                  {filterValues.length > 0 && <CommandSeparator />}
                  {hasGroups ? (
                    groupOptionsByGroup(nonSelectedOptions).map(({ group, items }, i) => (
                      <CommandGroup key={group ?? i} heading={group}>
                        {items.map((filter) =>
                          renderOptionItem(filter, false, () => handleSelect(filter.id))
                        )}
                      </CommandGroup>
                    ))
                  ) : (
                    <CommandGroup>
                      {nonSelectedOptions.map((filter) =>
                        renderOptionItem(filter, false, () => handleSelect(filter.id))
                      )}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </AnimateChangeInHeight>
      </PopoverContent>
    </Popover>
  )
}

// ─── Date range value component ─────────────────────────────────────────────

const DateRangeFilterValue = ({
  filterValues,
  setFilterValues,
}: {
  filterValues: string[] // [from, to]
  setFilterValues: (values: string[]) => void
}) => {
  const from = filterValues[0] ?? ""
  const to = filterValues[1] ?? ""

  return (
    <div className="flex items-center gap-[1px]">
      <input
        type="date"
        value={from}
        onChange={(e) => setFilterValues([e.target.value, to])}
        className="bg-muted hover:bg-muted/50 px-1.5 py-1 text-muted-foreground hover:text-primary transition shrink-0 outline-none text-xs h-6 w-[110px]"
        placeholder="From"
      />
      <span className="bg-muted px-1 py-1 text-muted-foreground text-xs shrink-0 h-6 flex items-center">&ndash;</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setFilterValues([from, e.target.value])}
        className="bg-muted hover:bg-muted/50 px-1.5 py-1 text-muted-foreground hover:text-primary transition shrink-0 outline-none text-xs h-6 w-[110px]"
        placeholder="To"
      />
    </div>
  )
}

// ─── Main Filters component ──────────────────────────────────────────────────

export default function Filters({
  filters,
  setFilters,
  typeConfigs,
}: {
  filters: Filter[]
  setFilters: Dispatch<SetStateAction<Filter[]>>
  typeConfigs: FilterTypeConfig[]
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {filters
        .filter((filter) => {
          const config = typeConfigs.find((t) => t.key === filter.type)
          // Date range filters are always shown (even with empty strings)
          if (config?.isDateRange) return true
          return filter.value?.length > 0
        })
        .map((filter) => {
          const config = typeConfigs.find((t) => t.key === filter.type)
          const isDateRange = config?.isDateRange ?? false
          return (
            <div
              key={filter.id}
              className="flex gap-[1px] items-center text-xs"
            >
              <div className="flex gap-1.5 shrink-0 rounded-l bg-muted px-1.5 py-1 items-center">
                {config?.icon}
                {config?.label ?? filter.type}
              </div>
              {!isDateRange && (
                <FilterOperatorDropdown
                  filterType={filter.type}
                  operator={filter.operator}
                  filterValues={filter.value}
                  typeConfigs={typeConfigs}
                  setOperator={(operator) => {
                    setFilters((prev) =>
                      prev.map((f) =>
                        f.id === filter.id ? { ...f, operator } : f
                      )
                    )
                  }}
                />
              )}
              {isDateRange ? (
                <DateRangeFilterValue
                  filterValues={filter.value}
                  setFilterValues={(filterValues) => {
                    setFilters((prev) =>
                      prev.map((f) =>
                        f.id === filter.id ? { ...f, value: filterValues } : f
                      )
                    )
                  }}
                />
              ) : (
                <FilterValueCombobox
                  filterType={filter.type}
                  filterValues={filter.value}
                  typeConfigs={typeConfigs}
                  setFilterValues={(filterValues) => {
                    setFilters((prev) =>
                      prev.map((f) => {
                        if (f.id !== filter.id) return f
                        const getOps = typeConfigs.find((t) => t.key === f.type)?.operators ?? defaultOperators
                        const validOps = getOps(filterValues)
                        return {
                          ...f,
                          value: filterValues,
                          operator: validOps.includes(f.operator) ? f.operator : validOps[0],
                        }
                      })
                    )
                  }}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${config?.label ?? filter.type} filter`}
                onClick={() => {
                  setFilters((prev) => prev.filter((f) => f.id !== filter.id))
                }}
                className="bg-muted rounded-l-none rounded-r-sm h-6 w-6 text-muted-foreground hover:text-primary hover:bg-muted/50 transition shrink-0"
              >
                <X className="size-3" />
              </Button>
            </div>
          )
        })}
    </div>
  )
}
