"use client"

import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightLeftIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { StatusSettingsRow } from "@/convex/statuses"
import { CATEGORY_LABELS, TASK_CATEGORIES, statusIconFor, type TaskCategory } from "@/convex/tasks/model"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusIcon } from "@/components/icons/status-icon"
import { toStatusColor } from "@/components/settings/color-swatch-picker"
import {
  InlineEditRow,
  MenuItemWithHint,
  SettingsListRow,
  SortableSettingsList,
  type InlineEditValues,
} from "@/components/settings/settings-list-row"
import {
  NEW_STATUS_COLOR,
  afterIdForMove,
  groupByCategory,
  reorderAfter,
} from "@/components/settings/settings-list-model"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { toastError } from "@/lib/toast-helpers"

/**
 * Settings → Statuses (docs/prd-tasks-refactor.md §4.1, D3), Linear's
 * Workflow structure: one section per fixed category in workflow order, the
 * org's statuses inside it in their order. Admins add, edit inline, reorder
 * (drag inside the category), set the default, archive/restore, delete
 * unused ones and move unused ones to another category; the server enforces
 * every rule. Members see the same list read-only.
 */

/** icon · name · description · marker · menu */
const COLUMNS = "grid min-w-0 flex-1 grid-cols-[16px_minmax(0,11rem)_minmax(0,1fr)_4.5rem_28px] items-center gap-3"

type Editing = { kind: "edit"; id: Id<"statuses"> } | { kind: "create"; category: TaskCategory } | null

function StatusesSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col">
          <Skeleton className="h-9 w-full rounded-md" />
          {Array.from({ length: i === 2 ? 3 : 1 }).map((__, j) => (
            <div key={j} className="flex h-10 items-center gap-3 border-b border-border/60 pl-6">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function SettingsStatuses() {
  const isAdmin = useIsAdmin()
  const adminRows = useQuery(api.statuses.listForSettings, isAdmin ? {} : "skip")
  // Members can't read the settings query; the workspace refs carry the same list.
  const refs = useQuery(api.workspaceRefs.get, isAdmin === false ? {} : "skip")

  const createStatus = useMutation(api.statuses.create)
  const updateStatus = useMutation(api.statuses.update)
  const setDefault = useMutation(api.statuses.setDefault)
  const archiveStatus = useMutation(api.statuses.archive)
  const restoreStatus = useMutation(api.statuses.restore)
  const removeStatus = useMutation(api.statuses.remove)
  const moveStatus = useMutation(api.statuses.move).withOptimisticUpdate((store, { id, afterId }) => {
    const current = store.getQuery(api.statuses.listForSettings, {})
    const moved = current?.find((row) => row._id === id)
    if (!current || !moved) return
    store.setQuery(
      api.statuses.listForSettings,
      {},
      reorderAfter(current, id, afterId, (row) => row.category === moved.category),
    )
  })

  const [editing, setEditing] = useState<Editing>(null)
  const [deleteTarget, setDeleteTarget] = useState<StatusSettingsRow | null>(null)

  const rows: StatusSettingsRow[] | undefined = isAdmin
    ? adminRows
    : refs?.statuses.map((s) => ({ ...s, inUse: true }))
  if (isAdmin === undefined || rows === undefined) return <StatusesSkeleton />

  const canEdit = isAdmin
  const groups = groupByCategory(rows)
  const activeCount = new Map<TaskCategory, number>(
    groups.map((g) => [g.category, g.rows.filter((r) => !r.archived).length]),
  )

  async function run(action: () => Promise<unknown>, fallback: string) {
    try {
      await action()
    } catch (err) {
      toastError(err, fallback)
    }
  }

  async function submitEdit(row: StatusSettingsRow, values: InlineEditValues) {
    try {
      await updateStatus({
        id: row._id,
        name: values.name,
        color: values.color,
        description: values.description || null,
      })
      setEditing(null)
    } catch (err) {
      toastError(err, "Failed to save status")
      throw err
    }
  }

  async function submitCreate(category: TaskCategory, values: InlineEditValues) {
    try {
      await createStatus({
        category,
        name: values.name,
        color: values.color,
        description: values.description || undefined,
      })
      setEditing(null)
    } catch (err) {
      toastError(err, "Failed to create status")
      throw err
    }
  }

  function reorder(groupRows: StatusSettingsRow[], from: number, to: number) {
    const afterId = afterIdForMove(
      groupRows.map((r) => r._id),
      from,
      to,
    )
    if (afterId === undefined) return
    void run(() => moveStatus({ id: groupRows[from]._id, afterId }), "Failed to reorder")
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const sortable = canEdit && editing === null && group.rows.length > 1
        const rowNodes = group.rows.map((row, index) =>
          editing?.kind === "edit" && editing.id === row._id ? (
            <InlineEditRow
              key={row._id}
              initial={{ name: row.name, color: toStatusColor(row.color), description: row.description ?? "" }}
              withDescription
              renderPreview={(color) => <StatusIcon icon={row.icon} color={color} />}
              namePlaceholder="Status name"
              submitLabel="Save"
              onSubmit={(values) => submitEdit(row, values)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <SettingsListRow
              key={row._id}
              muted={row.archived}
              sortable={sortable ? { id: row._id, index, label: row.name } : undefined}
            >
              <div className={COLUMNS}>
                <StatusIcon icon={row.icon} color={row.color} className={row.archived ? "opacity-50" : undefined} />
                <span className="truncate font-medium">{row.name}</span>
                <span className="truncate text-muted-foreground">{row.description}</span>
                <span className="text-right text-xs text-muted-foreground">
                  {row.isDefault ? "Default" : row.archived ? "Archived" : null}
                </span>
                {canEdit ? (
                  <StatusRowMenu
                    row={row}
                    isLastActive={!row.archived && (activeCount.get(row.category) ?? 0) <= 1}
                    onEdit={() => setEditing({ kind: "edit", id: row._id })}
                    onMakeDefault={() => void run(() => setDefault({ id: row._id }), "Failed to set default")}
                    onChangeCategory={(category) =>
                      void run(() => updateStatus({ id: row._id, category }), "Failed to change category")
                    }
                    onArchive={() => void run(() => archiveStatus({ id: row._id }), "Failed to archive status")}
                    onRestore={() => void run(() => restoreStatus({ id: row._id }), "Failed to restore status")}
                    onDelete={() => setDeleteTarget(row)}
                  />
                ) : (
                  <span />
                )}
              </div>
            </SettingsListRow>
          ),
        )

        return (
          <section key={group.category} aria-label={`${group.label} statuses`} className="flex flex-col">
            <div className="flex h-9 items-center gap-2 rounded-md bg-muted/50 pr-1 pl-3">
              <span className="text-[13px] font-medium">{group.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{group.rows.length}</span>
              <span className="flex-1" />
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Add ${group.label.toLowerCase()} status`}
                  onClick={() => setEditing({ kind: "create", category: group.category })}
                >
                  <PlusIcon />
                </Button>
              ) : null}
            </div>
            {sortable ? (
              <SortableSettingsList onReorder={(from, to) => reorder(group.rows, from, to)}>
                {rowNodes}
              </SortableSettingsList>
            ) : (
              rowNodes
            )}
            {editing?.kind === "create" && editing.category === group.category ? (
              <InlineEditRow
                initial={{ name: "", color: NEW_STATUS_COLOR[group.category], description: "" }}
                withDescription
                renderPreview={(color) => (
                  <StatusIcon
                    icon={statusIconFor(group.category, activeCount.get(group.category) ?? 0, (activeCount.get(group.category) ?? 0) + 1)}
                    color={color}
                  />
                )}
                namePlaceholder="Status name"
                submitLabel="Create"
                onSubmit={(values) => submitCreate(group.category, values)}
                onCancel={() => setEditing(null)}
              />
            ) : null}
          </section>
        )
      })}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete status"
        description={`Delete “${deleteTarget?.name ?? ""}”? This can't be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) void run(() => removeStatus({ id: target._id }), "Failed to delete status")
        }}
      />
    </div>
  )
}

function StatusRowMenu({
  row,
  isLastActive,
  onEdit,
  onMakeDefault,
  onChangeCategory,
  onArchive,
  onRestore,
  onDelete,
}: {
  row: StatusSettingsRow
  isLastActive: boolean
  onEdit: () => void
  onMakeDefault: () => void
  onChangeCategory: (category: TaskCategory) => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const archiveHint = row.isDefault
    ? "Make another status the default first"
    : isLastActive
      ? "Last active status in this category"
      : null
  const deleteHint = row.inUse
    ? "Used by tasks — archive instead"
    : row.isDefault
      ? "Make another status the default first"
      : isLastActive
        ? "Last active status in this category"
        : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          {!row.isDefault ? (
            <DropdownMenuItem disabled={row.archived} onSelect={onMakeDefault}>
              <StarIcon />
              <MenuItemWithHint hint={row.archived ? "Restore it first" : null}>Make default</MenuItemWithHint>
            </DropdownMenuItem>
          ) : null}
          {!row.inUse && !row.isDefault ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRightLeftIcon />
                Change category
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {TASK_CATEGORIES.filter((c) => c !== row.category).map((category) => (
                  <DropdownMenuItem key={category} onSelect={() => onChangeCategory(category)}>
                    <StatusIcon icon={statusIconFor(category, 0, 1)} color={row.color} />
                    {CATEGORY_LABELS[category]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {row.archived ? (
            <DropdownMenuItem onSelect={onRestore}>
              <ArchiveRestoreIcon />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={archiveHint !== null} onSelect={onArchive}>
              <ArchiveIcon />
              <MenuItemWithHint hint={archiveHint}>Archive</MenuItemWithHint>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" disabled={deleteHint !== null} onSelect={onDelete}>
            <Trash2Icon />
            <MenuItemWithHint hint={deleteHint}>Delete</MenuItemWithHint>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
