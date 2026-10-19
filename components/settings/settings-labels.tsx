"use client"

import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { LabelSettingsRow } from "@/convex/labels"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusDot } from "@/components/status-dot"
import { toStatusColor } from "@/components/settings/color-swatch-picker"
import {
  InlineEditRow,
  SettingsListRow,
  SortableSettingsList,
  type InlineEditValues,
} from "@/components/settings/settings-list-row"
import { afterIdForMove, formatTaskUsage, reorderAfter } from "@/components/settings/settings-list-model"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/**
 * Settings → Labels (docs/prd-tasks-refactor.md §4.2, D8), Linear's Labels
 * structure: a "New label" action, the active labels in their order (drag to
 * reorder) with usage, and archived labels in a collapsed group. Create and
 * edit happen inline (colour + name). Deleting removes the label from its
 * tasks (server, through the task write path). Members see the list
 * read-only, without usage.
 */

/** dot · name · usage · menu */
const COLUMNS = "grid min-w-0 flex-1 grid-cols-[16px_minmax(0,1fr)_6rem_28px] items-center gap-3"

type Row = LabelSettingsRow & { usageKnown: boolean }
type Editing = { kind: "edit"; id: Id<"labels"> } | { kind: "create" } | null

function LabelsSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex h-9 items-center justify-between">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-7 w-24" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 border-b border-border/60 pl-6">
          <Skeleton className="size-2.5 rounded-full" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ))}
    </div>
  )
}

export function SettingsLabels() {
  const isAdmin = useIsAdmin()
  const adminRows = useQuery(api.labels.listForSettings, isAdmin ? {} : "skip")
  // Members can't read the settings query; the workspace refs carry the labels.
  const refs = useQuery(api.workspaceRefs.get, isAdmin === false ? {} : "skip")

  const createLabel = useMutation(api.labels.create)
  const updateLabel = useMutation(api.labels.update)
  const archiveLabel = useMutation(api.labels.archive)
  const restoreLabel = useMutation(api.labels.restore)
  const removeLabel = useMutation(api.labels.remove)
  const moveLabel = useMutation(api.labels.move).withOptimisticUpdate((store, { id, afterId }) => {
    const current = store.getQuery(api.labels.listForSettings, {})
    if (current) store.setQuery(api.labels.listForSettings, {}, reorderAfter(current, id, afterId))
  })

  const [editing, setEditing] = useState<Editing>(null)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const rows: Row[] | undefined = isAdmin
    ? adminRows?.map((l) => ({ ...l, usageKnown: true }))
    : refs?.labels.map((l) => ({ ...l, usage: 0, usageCapped: false, usageKnown: false }))
  if (isAdmin === undefined || rows === undefined) return <LabelsSkeleton />

  const canEdit = isAdmin
  const active = rows.filter((l) => !l.archived)
  const archived = rows.filter((l) => l.archived)
  const sortable = canEdit && editing === null && active.length > 1

  async function run(action: () => Promise<unknown>, fallback: string) {
    try {
      await action()
    } catch (err) {
      toastError(err, fallback)
    }
  }

  async function submit(row: Row | null, values: InlineEditValues) {
    try {
      if (row) await updateLabel({ id: row._id, name: values.name, color: values.color })
      else await createLabel({ name: values.name, color: values.color })
      setEditing(null)
    } catch (err) {
      toastError(err, row ? "Failed to save label" : "Failed to create label")
      throw err
    }
  }

  function reorder(from: number, to: number) {
    const afterId = afterIdForMove(
      active.map((l) => l._id),
      from,
      to,
    )
    if (afterId === undefined) return
    void run(() => moveLabel({ id: active[from]._id, afterId }), "Failed to reorder")
  }

  function renderRow(row: Row, index: number, rowSortable: boolean) {
    if (editing?.kind === "edit" && editing.id === row._id) {
      return (
        <InlineEditRow
          key={row._id}
          initial={{ name: row.name, color: toStatusColor(row.color), description: "" }}
          renderPreview={(color) => <StatusDot color={color} className="size-2.5" />}
          namePlaceholder="Label name"
          submitLabel="Save"
          onSubmit={(values) => submit(row, values)}
          onCancel={() => setEditing(null)}
        />
      )
    }
    return (
      <SettingsListRow
        key={row._id}
        muted={row.archived}
        sortable={rowSortable ? { id: row._id, index, label: row.name } : undefined}
      >
        <div className={COLUMNS}>
          <span className="flex justify-center">
            <StatusDot color={row.color} className={cn("size-2.5", row.archived && "opacity-50")} />
          </span>
          <span className="truncate font-medium">{row.name}</span>
          <span className="text-right text-xs text-muted-foreground tabular-nums">
            {row.usageKnown ? formatTaskUsage(row.usage, row.usageCapped) : null}
          </span>
          {canEdit ? (
            <LabelRowMenu
              row={row}
              onEdit={() => setEditing({ kind: "edit", id: row._id })}
              onArchive={() => void run(() => archiveLabel({ id: row._id }), "Failed to archive label")}
              onRestore={() => void run(() => restoreLabel({ id: row._id }), "Failed to restore label")}
              onDelete={() => setDeleteTarget(row)}
            />
          ) : (
            <span />
          )}
        </div>
      </SettingsListRow>
    )
  }

  const activeRows = active.map((row, i) => renderRow(row, i, sortable))

  return (
    <div className="flex flex-col">
      <div className="flex h-9 items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {active.length === 1 ? "1 label" : `${active.length} labels`}
        </span>
        <span className="flex-1" />
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: "create" })}>
            <PlusIcon data-icon="inline-start" />
            New label
          </Button>
        ) : null}
      </div>

      <div className="border-t border-border/60">
        {editing?.kind === "create" ? (
          <InlineEditRow
            initial={{ name: "", color: "blue", description: "" }}
            renderPreview={(color) => <StatusDot color={color} className="size-2.5" />}
            namePlaceholder="Label name"
            submitLabel="Create"
            onSubmit={(values) => submit(null, values)}
            onCancel={() => setEditing(null)}
          />
        ) : null}

        {sortable ? <SortableSettingsList onReorder={reorder}>{activeRows}</SortableSettingsList> : activeRows}

        {active.length === 0 && editing?.kind !== "create" ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyTitle>No labels yet</EmptyTitle>
              <EmptyDescription>Labels tag tasks across projects, for example Bug or Copy.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>

      {archived.length > 0 ? (
        <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen} className="mt-6">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <ChevronRightIcon data-icon="inline-start" className={cn("transition-transform", archivedOpen && "rotate-90")} />
              Archived
              <span className="tabular-nums">{archived.length}</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 border-t border-border/60">
            {archived.map((row, i) => renderRow(row, i, false))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete label"
        description={
          deleteTarget && deleteTarget.usage > 0
            ? `Delete “${deleteTarget.name}”? Removes the label from ${formatTaskUsage(deleteTarget.usage, deleteTarget.usageCapped)}. This can't be undone.`
            : `Delete “${deleteTarget?.name ?? ""}”? This can't be undone.`
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target) return
          void run(async () => {
            const { detached } = await removeLabel({ id: target._id })
            if (detached > 0) toast.success(`Label deleted and removed from ${formatTaskUsage(detached, false)}`)
          }, "Failed to delete label")
        }}
      />
    </div>
  )
}

function LabelRowMenu({
  row,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  row: Row
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          {row.archived ? (
            <DropdownMenuItem onSelect={onRestore}>
              <ArchiveRestoreIcon />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onArchive}>
              <ArchiveIcon />
              Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
