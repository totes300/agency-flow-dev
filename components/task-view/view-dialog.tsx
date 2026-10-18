"use client"

import { useState } from "react"
import { VIEW_NAME_MAX_LENGTH } from "@/convex/tasks/model"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Segmented, SegmentedItem } from "@/components/task-view/segmented"
import { GlobeNavIcon, LockNavIcon } from "@/components/icons/nav-icons"

export type ViewDialogRequest =
  | { mode: "create"; initialName?: string; filterCount: number }
  | { mode: "rename"; initialName: string }

/**
 * New view / rename view (U5). Creating saves the current filters, grouping,
 * ordering, layout and properties as a personal view, or — admins only — a
 * workspace view everyone sees.
 */
export function ViewDialog({
  request,
  canManageWorkspace,
  onOpenChange,
  onSubmit,
}: {
  request: ViewDialogRequest | null
  canManageWorkspace: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, scope: "personal" | "workspace") => Promise<void> | void
}) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {request ? (
          <ViewDialogBody
            key={`${request.mode}:${request.mode === "rename" ? request.initialName : ""}`}
            request={request}
            canManageWorkspace={canManageWorkspace}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ViewDialogBody({
  request,
  canManageWorkspace,
  onCancel,
  onSubmit,
}: {
  request: ViewDialogRequest
  canManageWorkspace: boolean
  onCancel: () => void
  onSubmit: (name: string, scope: "personal" | "workspace") => Promise<void> | void
}) {
  const [name, setName] = useState(request.initialName ?? "")
  const [scope, setScope] = useState<"personal" | "workspace">("personal")
  const [saving, setSaving] = useState(false)
  const creating = request.mode === "create"
  const valid = name.trim().length > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      await onSubmit(name, scope)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{creating ? "New view" : "Rename view"}</DialogTitle>
        {creating ? (
          <DialogDescription>
            Saves the current filters, grouping, ordering, layout and display properties
            {request.filterCount > 0 ? ` (${request.filterCount} filter${request.filterCount === 1 ? "" : "s"} active)` : ""}.
          </DialogDescription>
        ) : (
          <DialogDescription className="sr-only">Give the view a new name.</DialogDescription>
        )}
      </DialogHeader>
      <Input
        autoFocus
        value={name}
        maxLength={VIEW_NAME_MAX_LENGTH}
        placeholder="View name"
        aria-label="View name"
        onChange={(e) => setName(e.target.value)}
      />
      {creating ? (
        <div className="flex flex-col gap-1.5">
          <Segmented value={scope} onValueChange={setScope} className="w-64" aria-label="Who sees this view">
            <SegmentedItem value="personal">
              <LockNavIcon data-icon="inline-start" />
              Personal
            </SegmentedItem>
            <SegmentedItem value="workspace" disabled={!canManageWorkspace}>
              <GlobeNavIcon data-icon="inline-start" />
              Workspace
            </SegmentedItem>
          </Segmented>
          <p className="text-xs text-muted-foreground">
            {canManageWorkspace
              ? "Workspace views are visible to everyone in the workspace."
              : "Workspace views are visible to everyone. Admins create them."}
          </p>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || saving}>
          {creating ? "Create view" : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  )
}
