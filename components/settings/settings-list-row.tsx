"use client"

import { useState, type KeyboardEvent, type ReactNode } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { GripVerticalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LIST_DRAG_SENSORS } from "@/components/task-view/task-table"
import { ColorSwatchPicker } from "@/components/settings/color-swatch-picker"
import type { StatusColorName } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Shared pieces of the Linear-style status and label settings lists
 * (docs/prd-tasks-refactor.md §4.1, §4.2): a sortable list, a row with an
 * always-present drag-handle gutter (so sortable and static rows align), and
 * the inline create/edit row (colour, name, optional description).
 */

const ROW_CLASS = "relative flex h-10 items-center border-b border-border/60 pl-6 pr-1 text-[13px]"

/** A dnd-kit sortable list; `onReorder(from, to)` fires on a drop that moved a row. */
export function SortableSettingsList({
  onReorder,
  children,
}: {
  onReorder: (from: number, to: number) => void
  children: ReactNode
}) {
  return (
    <DragDropProvider
      sensors={LIST_DRAG_SENSORS}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source } = event.operation
        if (!isSortable(source)) return
        const { initialIndex, index } = source
        if (initialIndex !== index) onReorder(initialIndex, index)
      }}
    >
      {children}
    </DragDropProvider>
  )
}

/**
 * One settings row. With `sortable` (inside a `SortableSettingsList`) the
 * left gutter holds the grip — drag by pointer, or focus it and use Space +
 * arrows; otherwise the gutter stays empty so columns line up.
 */
export function SettingsListRow({
  sortable,
  muted = false,
  className,
  children,
}: {
  sortable?: { id: string; index: number; label: string }
  muted?: boolean
  className?: string
  children: ReactNode
}) {
  if (sortable) {
    return (
      <SortableRow sortable={sortable} muted={muted} className={className}>
        {children}
      </SortableRow>
    )
  }
  return <div className={cn(ROW_CLASS, muted && "text-muted-foreground", className)}>{children}</div>
}

function SortableRow({
  sortable,
  muted,
  className,
  children,
}: {
  sortable: { id: string; index: number; label: string }
  muted: boolean
  className?: string
  children: ReactNode
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: sortable.id, index: sortable.index })
  return (
    <div
      ref={ref}
      className={cn(
        ROW_CLASS,
        muted && "text-muted-foreground",
        isDragging && "z-[1] bg-background shadow-sm",
        className,
      )}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={`Drag to reorder ${sortable.label}`}
        className="absolute inset-y-0 left-0 flex w-6 cursor-grab items-center justify-center text-muted-foreground/40 outline-none hover:text-muted-foreground focus-visible:text-foreground active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      {children}
    </div>
  )
}

export type InlineEditValues = { name: string; color: StatusColorName; description: string }

/**
 * Linear-style inline create/edit row: colour swatch popover, name, an
 * optional description, Cancel / Save. Enter saves, Esc cancels. `onSubmit`
 * rejects to keep the row open (the caller toasts the error).
 */
export function InlineEditRow({
  initial,
  withDescription = false,
  renderPreview,
  namePlaceholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: InlineEditValues
  withDescription?: boolean
  /** The colour preview inside the swatch trigger (status icon or dot). */
  renderPreview: (color: StatusColorName) => ReactNode
  namePlaceholder: string
  submitLabel: string
  onSubmit: (values: InlineEditValues) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [color, setColor] = useState(initial.color)
  const [description, setDescription] = useState(initial.description)
  const [saving, setSaving] = useState(false)
  const canSave = name.trim().length > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), color, description: description.trim() })
    } catch {
      // The caller surfaced the error; keep the row open for a fix.
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      void save()
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className={cn(ROW_CLASS, "h-12 gap-2 bg-muted/30")}>
      <ColorSwatchPicker value={color} onChange={setColor}>
        {renderPreview(color)}
      </ColorSwatchPicker>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={namePlaceholder}
        aria-label="Name"
        autoFocus
        className={cn("h-8 text-[13px] md:text-[13px]", withDescription ? "w-48 shrink-0" : "min-w-0 flex-1")}
      />
      {withDescription ? (
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Description (optional)"
          aria-label="Description"
          className="h-8 min-w-0 flex-1 text-[13px] md:text-[13px]"
        />
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  )
}

/** Disabled-menu-item body: the action plus a muted reason underneath. */
export function MenuItemWithHint({ children, hint }: { children: ReactNode; hint?: string | null }) {
  if (!hint) return <>{children}</>
  return (
    <span className="flex flex-col">
      <span>{children}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  )
}
