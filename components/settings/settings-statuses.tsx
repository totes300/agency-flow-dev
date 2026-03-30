"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { cn } from "@/lib/utils"
import { ColorPickerDropdown } from "@/components/color-picker-dropdown"
import { STATUS_TYPES, STATUS_COLOR_NAMES } from "@/convex/lib/constants"
import type { StatusType, StatusColorName } from "@/convex/lib/constants"
import { TYPE_LABELS } from "@/lib/display-constants"
import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import type { Id } from "@/convex/_generated/dataModel"
import {
  PlusIcon,
  GripVerticalIcon,
  Trash2Icon,
  PencilIcon,
  StarIcon,
} from "lucide-react"
import { toast } from "sonner"
import { StatusBadge } from "@/components/status-badge"
import { StatusColorSwatch } from "@/components/status-color-swatch"

// ─── Sub-components ─────────────────────────────────────────────────────────────

function SettingsStatusesSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i}>
          <div className="flex items-center justify-between border-b pb-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="size-4" />
          </div>
          <div className="space-y-1 pt-2">
            <Skeleton className="h-8 w-full" />
            {i < 2 && <Skeleton className="h-8 w-full" />}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function SettingsStatuses() {
  const statuses = useQuery(api.statuses.list, { includeArchived: true })
  const orgSettings = useQuery(api.orgSettings.get)
  const createStatus = useMutation(api.statuses.create)
  const updateStatus = useMutation(api.statuses.update)
  const removeStatus = useMutation(api.statuses.remove)
  const setDefaultStatus = useMutation(api.statuses.setDefault)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForType, setCreateForType] = useState<StatusType>("backlog")
  const [editingId, setEditingId] = useState<Id<"statuses"> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: Id<"statuses">; name: string } | null>(null)

  if (!statuses || !orgSettings) return <SettingsStatusesSkeleton />

  const activeStatuses = statuses.filter((s) => !s.archivedAt)
  const defaultStatusId = orgSettings.defaultStatusId

  const groupedStatuses = STATUS_TYPES.map((type) => ({
    type,
    statuses: activeStatuses.filter((s) => s.type === type),
  }))

  const editingStatus = editingId
    ? statuses.find((s) => s._id === editingId)
    : null

  return (
    <div>
      {groupedStatuses.map(({ type, statuses: groupStatuses }, index) => (
        <div key={type} className={cn(index > 0 ? "mt-6" : "")}>
          {/* Section header */}
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[type]}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                setCreateForType(type)
                setCreateOpen(true)
              }}
              aria-label={`Add ${TYPE_LABELS[type]} status`}
            >
              <PlusIcon className="size-4" />
            </Button>
          </div>

          {/* Status rows */}
          {groupStatuses.map((status) => {
            const isDefault = defaultStatusId === status._id
            return (
              <div
                key={status._id}
                className="group flex items-center gap-2 rounded-md px-1.5 py-2 transition-colors hover:bg-muted/40"
              >
                <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/60" />
                <StatusBadge name={status.name} color={status.color} type={status.type} variant="solid" />
                {isDefault && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Default</span>
                )}
                <span className="flex-1" />
                {/* Actions — appear on hover, visible on touch/focus */}
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={async () => {
                        try {
                          await setDefaultStatus({ id: status._id })
                        } catch {
                          toast.error("Failed to set default status")
                        }
                      }}
                      aria-label="Set as default"
                    >
                      <StarIcon className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setEditingId(status._id)}
                    aria-label="Edit"
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget({ id: status._id, name: status.name })}
                    aria-label="Delete"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete status"
        description={`Are you sure you want to delete \u201c${deleteTarget?.name}\u201d? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) {
            try {
              await removeStatus({ id: deleteTarget.id })
              setDeleteTarget(null)
            } catch {
              toast.error("Failed to delete status")
            }
          }
        }}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Status</DialogTitle>
            <DialogDescription>Create a new task status.</DialogDescription>
          </DialogHeader>
          <StatusForm
            initialValues={{ name: "", color: "gray", type: createForType }}
            submitLabel="Create Status"
            onSubmit={async (values) => {
              await createStatus(values)
              setCreateOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editingId}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Status</DialogTitle>
            <DialogDescription>Modify this status.</DialogDescription>
          </DialogHeader>
          {editingStatus && (
            <StatusForm
              key={editingId!}
              initialValues={{
                name: editingStatus.name,
                color: editingStatus.color,
                type: editingStatus.type,
              }}
              submitLabel="Save Changes"
              onSubmit={async (values) => {
                await updateStatus({ id: editingId!, ...values })
                setEditingId(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Status Form (create + edit dialog) ─────────────────────────────────────────

function StatusForm({
  initialValues,
  onSubmit,
  submitLabel,
}: {
  initialValues?: { name: string; color: string; type: StatusType }
  onSubmit: (values: { name: string; color: StatusColorName; type: StatusType }) => Promise<void>
  submitLabel: string
}) {
  const [name, setName] = useState(initialValues?.name ?? "")
  const [color, setColor] = useState<StatusColorName>((initialValues?.color ?? "gray") as StatusColorName)
  const [type, setType] = useState<StatusType>(initialValues?.type ?? "backlog")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), color, type })
    } catch {
      toast.error("Failed to save status")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. In Review"
          autoFocus
        />
      </div>

      {/* Group (type) */}
      <div className="space-y-2">
        <Label>Group</Label>
        <Select value={type} onValueChange={(v) => setType(v as StatusType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Color picker */}
      <div className="space-y-2">
        <Label>Color</Label>
        <ColorPickerDropdown
          value={color}
          onChange={setColor}
          colors={STATUS_COLOR_NAMES}
          renderSwatch={(c) => ({
            swatch: <StatusColorSwatch color={c} />,
            label: STATUS_COLOR_CONFIG[c]?.label ?? "Gray",
          })}
        />
      </div>

      <Button type="submit" disabled={!name.trim() || submitting} className="w-full">
        {submitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  )
}
