"use client"

import { useId } from "react"
import { CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Toggle } from "@/components/ui/toggle"
import {
  BoardLayoutIcon,
  ChevronDownNavIcon,
  DisplayNavIcon,
  ListLayoutIcon,
} from "@/components/icons/nav-icons"
import { cn } from "@/lib/utils"
import { COLUMNS } from "@/components/task-view/column-rules"
import { Segmented, SegmentedItem } from "@/components/task-view/segmented"
import type { DisplaySpec, GroupBy, OrderBy, ViewOption, ViewProperty } from "@/components/task-view/view-state"

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: "No grouping",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  project: "Project",
  client: "Client",
  workCategory: "Category",
  label: "Label",
}

const GROUP_BY_ORDER: GroupBy[] = ["status", "assignee", "project", "client", "priority", "workCategory", "label", "none"]

export const ORDER_BY_LABELS: Record<OrderBy, string> = {
  priority: "Priority",
  manual: "Manual",
  dueDate: "Due date",
  startDate: "Start date",
  title: "Title",
  createdAt: "Created",
  updatedAt: "Last updated",
  lastActivityAt: "Last activity",
}

const ORDER_BY_ORDER: OrderBy[] = ["priority", "manual", "dueDate", "startDate", "title", "lastActivityAt", "updatedAt", "createdAt"]

const PROPERTY_LABELS: Partial<Record<ViewProperty, string>> = { priority: "Priority" }

/** Toggleable display properties (title is always shown; the status icon is derived). */
const DISPLAY_PROPERTIES = COLUMNS.filter((c) => c.key !== "title" && c.key !== "statusIcon").map((c) => ({
  key: c.key,
  label: PROPERTY_LABELS[c.key] ?? c.header,
}))

/** The board needs a grouping; "No grouping" shows status columns. */
export function boardGroupBy(groupBy: GroupBy): Exclude<GroupBy, "none"> {
  return groupBy === "none" ? "status" : groupBy
}

/**
 * The Display menu (U6, Linear): List/Board, Grouping (Columns on the board),
 * Ordering, Show sub-tasks, Show empty groups, display properties, then
 * Reset / Save / Save as new / Set default for everyone. The round toolbar
 * button carries the "modified" dot while the URL differs from the view.
 * A plan view (My Tasks Today) keeps its layout and hand-made order: only the
 * display properties change, and nothing is saved.
 */
export function DisplayMenu({
  display,
  view,
  modified,
  isAdmin,
  onChange,
  onReset,
  onSave,
  onSaveAsNew,
  onSetDefault,
  hiddenGroupBy,
  hiddenProperties,
}: {
  display: DisplaySpec
  view: ViewOption
  modified: boolean
  isAdmin: boolean
  onChange: (patch: Partial<DisplaySpec>) => void
  onReset: () => void
  onSave: () => void
  onSaveAsNew: () => void
  onSetDefault: () => void
  /** Groupings and properties the surface's context makes redundant (a project's own tab). */
  hiddenGroupBy?: ReadonlySet<GroupBy>
  hiddenProperties?: ReadonlySet<ViewProperty>
}) {
  const board = display.layout === "board"
  const groupBy = board ? boardGroupBy(display.groupBy) : display.groupBy
  const subId = useId()
  const emptyId = useId()
  const locked = view.plan === true
  const canSave = view.scope !== "system" && view.canEdit
  const canSetDefault = isAdmin && view.scope !== "personal" && !locked

  const toggleProperty = (key: ViewProperty) =>
    onChange({
      visibleProperties: display.visibleProperties.includes(key)
        ? display.visibleProperties.filter((p) => p !== key)
        : [...display.visibleProperties, key],
    })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="relative rounded-full"
          aria-label={modified ? "Display options (view modified)" : "Display options"}
          title="Display options"
        >
          <DisplayNavIcon />
          {modified ? (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] gap-0 p-3">
        <Segmented
          value={display.layout}
          onValueChange={(layout) => onChange({ layout })}
          className="w-full"
          aria-label="Layout"
          disabled={locked}
        >
          <SegmentedItem value="list">
            <ListLayoutIcon data-icon="inline-start" />
            List
          </SegmentedItem>
          <SegmentedItem value="board">
            <BoardLayoutIcon data-icon="inline-start" />
            Board
          </SegmentedItem>
        </Segmented>

        <div className="mt-2 flex flex-col">
          <DisplayRow label={board ? "Columns" : "Grouping"}>
            <OptionSelect
              value={groupBy}
              disabled={locked}
              options={GROUP_BY_ORDER.filter((g) => (!board || g !== "none") && !hiddenGroupBy?.has(g))}
              labels={GROUP_BY_LABELS}
              onSelect={(value) => onChange({ groupBy: value })}
            />
          </DisplayRow>
          <DisplayRow label="Ordering">
            <OptionSelect
              value={display.orderBy}
              disabled={locked}
              options={ORDER_BY_ORDER}
              labels={ORDER_BY_LABELS}
              onSelect={(value) => onChange({ orderBy: value })}
            />
          </DisplayRow>
          <DisplayRow label="Show sub-tasks" htmlFor={subId}>
            <Switch
              id={subId}
              checked={display.showSubtasks}
              disabled={locked}
              onCheckedChange={(checked) => onChange({ showSubtasks: checked })}
            />
          </DisplayRow>
          <DisplayRow label={board ? "Show empty columns" : "Show empty groups"} htmlFor={emptyId}>
            <Switch
              id={emptyId}
              checked={display.showEmptyGroups}
              disabled={locked || (!board && display.groupBy === "none")}
              onCheckedChange={(checked) => onChange({ showEmptyGroups: checked })}
            />
          </DisplayRow>
        </div>
        {locked ? (
          <p className="pt-1 text-xs text-muted-foreground">Today keeps your hand-made order. Drag rows to reorder.</p>
        ) : null}

        <Separator className="my-2.5 -mx-3 w-auto" />
        <p className="text-[13px] text-muted-foreground">Display properties</p>
        <div className="flex flex-wrap gap-1 pt-2">
          {DISPLAY_PROPERTIES.filter((p) => !hiddenProperties?.has(p.key)).map((p) => (
            <Toggle
              key={p.key}
              size="sm"
              pressed={display.visibleProperties.includes(p.key)}
              onPressedChange={() => toggleProperty(p.key)}
              className="h-7 font-normal text-muted-foreground data-[state=on]:text-foreground"
            >
              {p.label}
            </Toggle>
          ))}
        </div>

        <Separator className="my-2.5 -mx-3 w-auto" />
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button variant="ghost" size="sm" disabled={!modified} onClick={onReset}>
            Reset
          </Button>
          {locked ? null : (
            <Button variant="ghost" size="sm" onClick={onSaveAsNew}>
              Save as new view
            </Button>
          )}
          {canSave ? (
            <Button variant="ghost" size="sm" disabled={!modified} onClick={onSave}>
              Save
            </Button>
          ) : null}
          {canSetDefault ? (
            <Button variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={onSetDefault}>
              Set default for everyone
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DisplayRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

function OptionSelect<T extends string>({
  value,
  options,
  labels,
  onSelect,
  disabled = false,
}: {
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onSelect: (value: T) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="outline" size="sm" className="w-40 justify-between font-normal" disabled={disabled}>
          {labels[value]}
          <ChevronDownNavIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {options.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onSelect(option)}>
            {labels[option]}
            <CheckIcon className={cn("ml-auto", option !== value && "invisible")} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
