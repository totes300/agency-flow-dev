"use client"

import { useMemo, useState, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  ChevronLeftNavIcon,
  ChevronRightNavIcon,
  CloseNavIcon,
  FilterNavIcon,
  PlusNavIcon,
} from "@/components/icons/nav-icons"
import {
  activeFacetFields,
  clearFacet,
  deriveFacetOptions,
  toggleFacetValue,
  type FacetField,
  type FacetSelection,
} from "@/lib/facet-filter"

/**
 * Notion-style filters for non-task lists (the projects directory), the same
 * UI as the task view's `filter-menu.tsx` over the generic model in
 * `lib/facet-filter.ts`: the round toolbar button opens a two-step menu (pick
 * a property, then values with faceted counts); active filters render as
 * quiet chips under the toolbar that reopen their value menu, with "+ Filter"
 * and Clear beside them.
 */

export type FacetFilterField<T, F extends string> = FacetField<T, F> & {
  icon: ReactNode
}

export type FacetFilterContext<T, F extends string> = {
  /** The list the filters narrow (already scoped to the active tab and search). */
  items: readonly T[]
  fields: readonly FacetFilterField<T, F>[]
  selection: FacetSelection<F>
  onChange: (selection: FacetSelection<F>) => void
}

/** Step 2 (and a chip's menu): the faceted value list of one property. */
function FacetValueList<T, F extends string>({
  field,
  ctx,
  onBack,
}: {
  field: FacetFilterField<T, F>
  ctx: FacetFilterContext<T, F>
  onBack?: () => void
}) {
  const options = useMemo(
    () => deriveFacetOptions(ctx.items, ctx.fields, ctx.selection, field.key),
    [ctx.items, ctx.fields, ctx.selection, field.key],
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
          <CommandInput autoFocus placeholder={`${field.label}…`} />
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
              onSelect={() => ctx.onChange(toggleFacetValue(ctx.selection, field.key, option.key))}
            >
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
function FieldList<T, F extends string>({
  fields,
  onPick,
}: {
  fields: readonly FacetFilterField<T, F>[]
  onPick: (field: FacetFilterField<T, F>) => void
}) {
  return (
    <Command>
      <CommandInput autoFocus placeholder="Filter…" />
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        <CommandGroup>
          {fields.map((f) => (
            <CommandItem key={f.key} value={f.label} onSelect={() => onPick(f)}>
              {f.icon}
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
function AddFilterBody<T, F extends string>({ ctx }: { ctx: FacetFilterContext<T, F> }) {
  const [field, setField] = useState<FacetFilterField<T, F> | null>(null)
  return field ? (
    <FacetValueList field={field} ctx={ctx} onBack={() => setField(null)} />
  ) : (
    <FieldList fields={ctx.fields} onPick={setField} />
  )
}

/** Round toolbar button that opens the two-step filter menu. */
export function FacetFilterButton<T, F extends string>({
  ctx,
  label = "Filter",
}: {
  ctx: FacetFilterContext<T, F>
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className="rounded-full" aria-label={label} title={label}>
          <FilterNavIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 p-0">
        {open ? <AddFilterBody ctx={ctx} /> : null}
      </PopoverContent>
    </Popover>
  )
}

function chipValueText<T, F extends string>(field: FacetFilterField<T, F>, ctx: FacetFilterContext<T, F>): string {
  const values = ctx.selection[field.key] ?? []
  if (values.length > 1) return `${values.length} selected`
  const value = values[0] ?? ""
  const source = ctx.items.find((item) => field.valueOf(item) === value)
  return source ? field.labelOf(source) : value
}

/** One active filter: a quiet chip that reopens its value menu, with a remove ×. */
function FacetFilterChip<T, F extends string>({
  field,
  ctx,
}: {
  field: FacetFilterField<T, F>
  ctx: FacetFilterContext<T, F>
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-flex h-7 max-w-64 items-center rounded-md bg-muted text-[13px]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-full min-w-0 items-center gap-1.5 rounded-l-md pl-2.5 pr-1 outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="text-muted-foreground">{field.label}</span>
            <span className="min-w-0 truncate font-medium">{chipValueText(field, ctx)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 gap-0 p-0">
          {open ? <FacetValueList field={field} ctx={ctx} /> : null}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remove ${field.label} filter`}
        className="grid size-7 shrink-0 place-items-center rounded-r-md text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => ctx.onChange(clearFacet(ctx.selection, field.key))}
      >
        <CloseNavIcon size={12} strokeWidth={1.8} />
      </button>
    </span>
  )
}

/** The chip row under the toolbar, shown while filters are active. */
export function FacetFilterChips<T, F extends string>({ ctx }: { ctx: FacetFilterContext<T, F> }) {
  const [adding, setAdding] = useState(false)
  const active = activeFacetFields(ctx.fields, ctx.selection)
  if (active.length === 0) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2.5">
      {active.map((field) => (
        <FacetFilterChip key={field.key} field={field} ctx={ctx} />
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
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => ctx.onChange({})}>
        Clear
      </Button>
    </div>
  )
}
