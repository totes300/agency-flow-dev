"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { PlusCircleIcon, XCircleIcon, ChevronDownIcon, CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FilterOp } from "@/lib/hooks/use-task-filters"

type FilterOption = {
  id: string
  label: string
  color?: string
}

const OPERATORS: { key: FilterOp; label: string }[] = [
  { key: "is", label: "is" },
  { key: "isNot", label: "is not" },
  { key: "anyOf", label: "any of" },
  { key: "noneOf", label: "none of" },
]

const MULTI_OPS: FilterOp[] = ["anyOf", "noneOf"]

export function FilterPill({
  label,
  options,
  value,
  operator,
  onSelect,
  onOperatorChange,
  onClear,
  multiSelect = false,
}: {
  label: string
  options: FilterOption[]
  value: string | null
  operator: FilterOp
  onSelect: (ids: string) => void
  onOperatorChange: (op: FilterOp) => void
  onClear: () => void
  multiSelect?: boolean
}) {
  const [valueOpen, setValueOpen] = useState(false)
  const selectedIds = value ? value.split(",") : []
  const isMulti = multiSelect || MULTI_OPS.includes(operator)

  const selectedLabels = selectedIds
    .map((id) => options.find((o) => o.id === id)?.label)
    .filter(Boolean)
    .join(", ")

  const operatorLabel = OPERATORS.find((o) => o.key === operator)?.label ?? "is"

  // ── Inactive pill ─────────────────────────────────────────────────────
  if (!value) {
    return (
      <Popover open={valueOpen} onOpenChange={setValueOpen}>
        <PopoverTrigger asChild>
          <button className="flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-border/80 hover:bg-muted/30">
            <PlusCircleIcon className="size-3" />
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <ValueList
            label={label}
            options={options}
            selectedIds={selectedIds}
            isMulti={isMulti}
            onToggle={(id) => handleToggle(id)}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // ── Active pill ───────────────────────────────────────────────────────
  return (
    <div className="flex h-7 items-center rounded-md border border-border bg-background">
      {/* ⊗ Close button */}
      <button
        onClick={onClear}
        className="flex items-center pl-1.5 pr-0.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        aria-label={`Remove ${label} filter`}
      >
        <XCircleIcon className="size-3" />
      </button>

      {/* Field label */}
      <span className="pr-0.5 text-xs font-medium text-foreground">
        {label}
      </span>

      {/* Separator */}
      <span className="h-3.5 w-px bg-border" />

      {/* Operator dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-0.5 px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            {operatorLabel}
            <ChevronDownIcon className="size-2.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[100px]">
          {OPERATORS.filter((o) => multiSelect || !MULTI_OPS.includes(o.key) || MULTI_OPS.includes(operator)).map((op) => (
            <DropdownMenuItem
              key={op.key}
              onClick={() => {
                // Normalize multi-value to single when switching to single-value operator
                if (!MULTI_OPS.includes(op.key) && selectedIds.length > 1) {
                  onSelect(selectedIds[0] ?? "")
                }
                onOperatorChange(op.key)
              }}
              className={cn(operator === op.key && "font-semibold")}
            >
              {op.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Separator */}
      <span className="h-3.5 w-px bg-border" />

      {/* Value(s) — click to reopen */}
      <Popover open={valueOpen} onOpenChange={setValueOpen}>
        <PopoverTrigger asChild>
          <button className="flex max-w-[160px] items-center gap-0.5 truncate pl-1 pr-2 text-xs font-medium text-primary transition-colors hover:text-primary/80">
            <span className="truncate">{selectedLabels || "..."}</span>
            <ChevronDownIcon className="size-2.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <ValueList
            label={label}
            options={options}
            selectedIds={selectedIds}
            isMulti={isMulti}
            onToggle={(id) => handleToggle(id)}
          />
        </PopoverContent>
      </Popover>
    </div>
  )

  function handleToggle(id: string) {
    if (isMulti) {
      const current = new Set(selectedIds)
      if (current.has(id)) {
        current.delete(id)
      } else {
        current.add(id)
      }
      const newValue = [...current].join(",")
      onSelect(newValue || "")
      if (!newValue) onClear()
    } else {
      onSelect(id)
      setValueOpen(false)
    }
  }
}

// ─── Value list dropdown ────────────────────────────────────────────────────

function ValueList({
  label,
  options,
  selectedIds,
  isMulti,
  onToggle,
}: {
  label: string
  options: FilterOption[]
  selectedIds: string[]
  isMulti: boolean
  onToggle: (id: string) => void
}) {
  return (
    <Command>
      <div className="px-3 pt-3 pb-1.5 text-[13px] font-semibold text-foreground">
        Filter by: {label.toLowerCase()}
      </div>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup>
          {options.map((opt) => {
            const isSelected = selectedIds.includes(opt.id)
            return (
              <CommandItem
                key={opt.id}
                onSelect={() => onToggle(opt.id)}
                className="gap-2.5"
              >
                {isMulti ? (
                  <Checkbox
                    checked={isSelected}
                    className="pointer-events-none size-4"
                    tabIndex={-1}
                  />
                ) : (
                  isSelected && <CheckIcon className="size-3.5 shrink-0 text-primary" />
                )}
                {opt.color && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                <span className={cn("truncate", isSelected && "font-medium")}>
                  {opt.label}
                </span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
