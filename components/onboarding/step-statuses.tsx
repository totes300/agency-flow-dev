"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { STATUS_TYPES, STATUS_COLOR_NAMES } from "@/convex/lib/constants"
import type { StatusType, StatusColorName } from "@/convex/lib/constants"
import { TYPE_LABELS } from "@/lib/display-constants"
import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import { StatusDot } from "./shared"
import type { StatusDraft } from "./shared"
import {
  PlusIcon,
  XIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "lucide-react"

// ─── Constants ──────────────────────────────────────────────────────────────────

const TYPE_DESCRIPTIONS: Record<StatusType, string> = {
  backlog: "Unprioritized work",
  in_progress: "Actively being worked on",
  review: "Waiting on someone",
  blocked: "Cannot proceed",
  done: "Completed",
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function StepStatuses({
  statuses,
  onChange,
}: {
  statuses: StatusDraft[]
  onChange: (s: StatusDraft[]) => void
}) {
  const [addingToType, setAddingToType] = useState<StatusType | null>(null)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<StatusColorName>("gray")

  function getOrdered(): StatusDraft[] {
    return STATUS_TYPES.flatMap((type) => statuses.filter((s) => s.type === type))
  }

  function statusesForType(type: StatusType) {
    return statuses.filter((s) => s.type === type)
  }

  function handleRemove(id: string) {
    onChange(statuses.filter((s) => s.id !== id))
  }

  function handleEdit(id: string, field: Partial<StatusDraft>) {
    onChange(statuses.map((s) => (s.id === id ? { ...s, ...field } : s)))
  }

  function handleMove(statusId: string, direction: -1 | 1) {
    const ordered = getOrdered()
    const idx = ordered.findIndex((s) => s.id === statusId)
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= ordered.length) return

    const current = ordered[idx]
    const target = ordered[targetIdx]

    if (current.type === target.type) {
      const next = [...ordered]
      ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
      onChange(next)
    } else {
      const newType = target.type
      const updated = ordered.filter((s) => s.id !== statusId)
      const movedStatus = { ...current, type: newType }

      if (direction === 1) {
        const lastIdx = updated.findLastIndex((s) => s.type === newType)
        updated.splice(lastIdx + 1, 0, movedStatus)
      } else {
        const firstIdx = updated.findIndex((s) => s.type === newType)
        updated.splice(firstIdx === -1 ? targetIdx : firstIdx, 0, movedStatus)
      }

      onChange(updated)
    }
  }

  function handleAdd(type: StatusType) {
    if (!newName.trim()) return
    onChange([...statuses, {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color: newColor,
      type,
    }])
    setNewName("")
    setNewColor("gray")
    setAddingToType(null)
  }

  const ordered = getOrdered()
  const isFirst = (id: string) => ordered[0]?.id === id
  const isLast = (id: string) => ordered[ordered.length - 1]?.id === id

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Customize your workflow. Use arrows to reorder — statuses move between stages when crossing a boundary.
      </p>

      {STATUS_TYPES.map((type) => {
        const group = statusesForType(type)
        return (
          <div key={type}>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                {TYPE_LABELS[type]}
              </span>
              <span className="text-xs text-muted-foreground">
                {TYPE_DESCRIPTIONS[type]}
              </span>
            </div>

            <div className="space-y-0.5 pl-1">
              {group.length === 0 && (
                <p className="px-2 py-1 text-xs italic text-muted-foreground/60">
                  No statuses — move one here or add below
                </p>
              )}
              {group.map((status) => (
                <div
                  key={status.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
                >
                  <div className="relative">
                    <StatusDot color={status.color} />
                    <select
                      className="absolute inset-0 cursor-pointer opacity-0"
                      value={status.color}
                      onChange={(e) => handleEdit(status.id, { color: e.target.value as StatusColorName })}
                      aria-label="Status color"
                    >
                      {STATUS_COLOR_NAMES.map((c) => (
                        <option key={c} value={c}>{STATUS_COLOR_CONFIG[c].label}</option>
                      ))}
                    </select>
                  </div>

                  <Input
                    value={status.name}
                    onChange={(e) => handleEdit(status.id, { name: e.target.value })}
                    className="h-7 flex-1 border-transparent bg-transparent px-1 text-sm hover:border-input focus:border-input"
                  />

                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleMove(status.id, -1)}
                      disabled={isFirst(status.id)}
                      aria-label="Move up"
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleMove(status.id, 1)}
                      disabled={isLast(status.id)}
                      aria-label="Move down"
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(status.id)}
                      aria-label="Remove"
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
              ))}

              {addingToType === type ? (
                <form
                  className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1"
                  onSubmit={(e) => { e.preventDefault(); handleAdd(type) }}
                >
                  <StatusDot color={newColor} />
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Status name"
                    className="h-7 flex-1 border-transparent bg-transparent px-1 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setAddingToType(null)
                    }}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    type="submit"
                    disabled={!newName.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    onClick={() => { setAddingToType(null); setNewName("") }}
                    aria-label="Cancel"
                  >
                    <XIcon />
                  </Button>
                </form>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => { setAddingToType(type); setNewName(""); setNewColor("gray") }}
                  aria-label={`Add ${TYPE_LABELS[type]} status`}
                >
                  <PlusIcon />
                  Add status
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
