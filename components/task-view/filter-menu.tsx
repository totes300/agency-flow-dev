"use client"

import { useMemo, useState, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { NONE_FILTER_VALUE, type TaskPriority } from "@/convex/tasks/model"
import { getCategoryColor } from "@/convex/lib/constants"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { UserAvatar } from "@/components/user-avatar"
import { StatusIcon } from "@/components/icons/status-icon"
import { PriorityIcon } from "@/components/icons/priority-icon"
import {
  ChevronLeftNavIcon,
  ChevronRightNavIcon,
  ClientsNavIcon,
  CloseNavIcon,
  CommentNavIcon,
  FilterNavIcon,
  LabelNavIcon,
  NoAssigneeNavIcon,
  PlusNavIcon,
  ProjectsNavIcon,
  UserNavIcon,
} from "@/components/icons/nav-icons"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import {
  FILTER_FIELDS,
  chipFor,
  facetOptions,
  filterFieldLabel,
  isFilterField,
  removeChip,
  toggleChipValue,
  valueLabel,
  type FacetOption,
  type FilterField,
} from "@/components/task-view/filter-model"
import type { RefIndex, TaskRowModel } from "@/components/task-view/row-model"
import type { ListFilter } from "@/components/task-view/view-state"

/**
 * Notion-style filters (U7, `feedback_notion_filter_pattern`): "+ Filter"
 * opens a two-step menu — pick a property, then values with faceted counts
 * over the loaded rows. Active filters render as quiet chips that reopen
 * their value menu; there are no permanent per-property chips. Filters are
 * transient URL state until the view is saved.
 */

type FacetContext = {
  rows: readonly TaskRowModel[]
  chips: readonly ListFilter[]
  index: RefIndex
  me: string
  onChange: (chips: ListFilter[]) => void
  /** Fields the surface's context makes redundant (a project's own tab: project, client). */
  hiddenFields?: ReadonlySet<FilterField>
}

const FIELD_ICON: Record<FilterField, ReactNode> = {
  status: <StatusIcon icon={{ kind: "pie", fill: 0.5 }} color="amber" className="size-3.5" />,
  priority: <PriorityIcon priority={2} label={false} />,
  assignee: <UserNavIcon className="text-muted-foreground" />,
  label: <LabelNavIcon className="text-muted-foreground" />,
  project: <ProjectsNavIcon className="text-muted-foreground" />,
  client: <ClientsNavIcon className="text-muted-foreground" />,
  workCategory: <LabelNavIcon className="text-muted-foreground" />,
  createdBy: <UserNavIcon className="text-muted-foreground" />,
  newComments: <CommentNavIcon className="text-muted-foreground" />,
}

function ValueIcon({ field, option, index }: { field: FilterField; option: FacetOption; index: RefIndex }) {
  switch (field) {
    case "status": {
      const status = index.statusById.get(option.key as Id<"statuses">)
      return status ? <StatusIcon icon={status.icon} color={status.color} className="size-3.5" /> : null
    }
    case "priority":
      return <PriorityIcon priority={Number(option.key) as TaskPriority} label={false} />
    case "assignee":
    case "createdBy": {
      if (option.key === NONE_FILTER_VALUE) return <NoAssigneeNavIcon className="text-muted-foreground" />
      const member = index.memberById.get(option.key as Id<"users">)
      return member ? <UserAvatar name={member.name} imageUrl={member.imageUrl} size="sm" className="size-5" /> : null
    }
    case "label":
      return option.color ? <Dot color={getStatusColor(option.color).dot} /> : <Dot muted />
    case "workCategory":
      return option.color ? <Dot color={getCategoryColor(option.color).dot} /> : <Dot muted />
    case "newComments":
      return <CommentNavIcon className={option.key === "true" ? "text-destructive" : "text-muted-foreground"} />
    default:
      return null
  }
}

function Dot({ color, muted }: { color?: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("mx-1 size-2 shrink-0 rounded-full", muted && "ring-1 ring-muted-foreground/50 ring-inset")}
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}

/** Step 2 (and a chip's menu): the faceted value list of one property. */
function FacetValueList({
  field,
  ctx,
  onBack,
}: {
  field: FilterField
  ctx: FacetContext
  onBack?: () => void
}) {
  const options = useMemo(
    () => facetOptions(ctx.rows, ctx.chips, field, ctx.index, ctx.me),
    [ctx.rows, ctx.chips, field, ctx.index, ctx.me],
  )
  return (
    <Command>
      <div className="flex items-center gap-1 pl-1">
        {onBack ? (
          <Button variant="ghost" size="icon-xs" aria-label="Back to properties" onClick={onBack}>
            <ChevronLeftNavIcon />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <CommandInput autoFocus placeholder={`${filterFieldLabel(field)}…`} />
        </div>
      </div>
      <CommandList>
        <CommandEmpty>No values in this view</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.key}
              value={`${option.label} ${option.key}`}
              keywords={[option.label]}
              onSelect={() => ctx.onChange(toggleChipValue(ctx.chips, field, option.key, ctx.me))}
            >
              <ValueIcon field={field} option={option} index={ctx.index} />
              <span className="min-w-0 truncate">{option.label}</span>
              <CommandShortcut className="flex items-center tracking-normal tabular-nums">
                {option.selected ? <CheckIcon className="size-4 text-foreground" /> : option.count}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** Step 1: the property list. */
function FieldList({
  onPick,
  hidden,
}: {
  onPick: (field: FilterField) => void
  hidden?: ReadonlySet<FilterField>
}) {
  return (
    <Command>
      <div className="flex items-center gap-1 pr-2">
        <div className="min-w-0 flex-1">
          <CommandInput autoFocus placeholder="Filter…" />
        </div>
        <Kbd className="mt-1">F</Kbd>
      </div>
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        <CommandGroup>
          {FILTER_FIELDS.filter((f) => !hidden?.has(f.key)).map((f) => (
            <CommandItem key={f.key} value={f.label} onSelect={() => onPick(f.key)}>
              {FIELD_ICON[f.key]}
              <span>{f.label}</span>
              <CommandShortcut className="flex items-center">
                <ChevronRightNavIcon className="text-muted-foreground" />
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** The two-step "+ Filter" popover body. */
function AddFilterBody({ ctx }: { ctx: FacetContext }) {
  const [field, setField] = useState<FilterField | null>(null)
  return field ? (
    <FacetValueList field={field} ctx={ctx} onBack={() => setField(null)} />
  ) : (
    <FieldList onPick={setField} hidden={ctx.hiddenFields} />
  )
}

/** Round toolbar button (F) that opens the two-step filter menu. */
export function FilterButton({
  open,
  onOpenChange,
  ctx,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ctx: FacetContext
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className="rounded-full" aria-label="Filter" title="Filter (F)">
          <FilterNavIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 p-0">
        {open ? <AddFilterBody ctx={ctx} /> : null}
      </PopoverContent>
    </Popover>
  )
}

function chipValueText(chip: ListFilter, ctx: FacetContext): string {
  if (chip.operator === "isEmpty") return "is empty"
  if (chip.operator === "isNotEmpty") return "is set"
  if (chip.values.length > 1) return `${chip.values.length} selected`
  const value = chip.values[0] ?? ""
  if (chip.property === "dueDate" || chip.property === "startDate") {
    return `${chip.operator === "before" ? "before " : chip.operator === "after" ? "after " : ""}${value}`
  }
  return valueLabel(chip.property, value, ctx.index, ctx.me)
}

/** One active filter: a quiet chip that reopens its value menu, with a remove ×. */
function FilterChip({ chip, ctx }: { chip: ListFilter; ctx: FacetContext }) {
  const [open, setOpen] = useState(false)
  const editable = isFilterField(chip.property) && chip.operator === "is" && chipFor(ctx.chips, chip.property) === chip
  const label = (
    <>
      <span className="text-muted-foreground">
        {filterFieldLabel(chip.property)}
        {chip.operator === "isNot" ? " is not" : ""}
      </span>
      <span className="min-w-0 truncate font-medium">{chipValueText(chip, ctx)}</span>
    </>
  )
  return (
    <span className="inline-flex h-7 max-w-64 items-center rounded-md bg-muted text-[13px]">
      {editable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="flex h-full min-w-0 items-center gap-1.5 rounded-l-md pl-2.5 pr-1 outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/40">
              {label}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 gap-0 p-0">
            {open ? <FacetValueList field={chip.property as FilterField} ctx={ctx} /> : null}
          </PopoverContent>
        </Popover>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 pl-2.5 pr-1">{label}</span>
      )}
      <button
        type="button"
        aria-label={`Remove ${filterFieldLabel(chip.property)} filter`}
        className="grid size-7 shrink-0 place-items-center rounded-r-md text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => ctx.onChange(removeChip(ctx.chips, chip))}
      >
        <CloseNavIcon size={12} strokeWidth={1.8} />
      </button>
    </span>
  )
}

/** The chip row under the toolbar, shown while filters are active. */
export function FilterChips({ ctx }: { ctx: FacetContext }) {
  const [adding, setAdding] = useState(false)
  if (ctx.chips.length === 0) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2.5">
      {ctx.chips.map((chip, i) => (
        <FilterChip key={`${chip.property}:${chip.operator}:${i}`} chip={chip} ctx={ctx} />
      ))}
      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <PlusNavIcon data-icon="inline-start" />
            Filter
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 gap-0 p-0">
          {adding ? <AddFilterBody ctx={ctx} /> : null}
        </PopoverContent>
      </Popover>
      <span className="flex-1" />
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => ctx.onChange([])}>
        Clear
      </Button>
    </div>
  )
}

export type { FacetContext }
