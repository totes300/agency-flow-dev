"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { STATUS_COLOR_NAMES } from "@/convex/lib/constants"
import type { StatusColorName } from "@/convex/lib/constants"
import { CATEGORY_LABELS, TASK_CATEGORIES, type TaskCategory } from "@/convex/tasks/model"
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

const CATEGORY_DESCRIPTIONS: Record<TaskCategory, string> = {
  backlog: "Not planned yet",
  unstarted: "Planned, not started",
  started: "Being worked on, in review or stuck",
  completed: "Finished",
  canceled: "Won't be done",
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function StepStatuses({
  statuses,
  onChange,
}: {
  statuses: StatusDraft[]
  onChange: (s: StatusDraft[]) => void
}) {
  const [addingToType, setAddingToType] = useState<TaskCategory | null>(null)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<StatusColorName>("gray")

  function getOrdered(): StatusDraft[] {
    return TASK_CATEGORIES.flatMap((category) => statuses.filter((s) => s.category === category))
  }

  function statusesForCategory(category: TaskCategory) {
    return statuses.filter((s) => s.category === category)
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

    if (current.category === target.category) {
      const next = [...ordered]
      ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
      onChange(next)
    } else {
      const newCategory = target.category
      const updated = ordered.filter((s) => s.id !== statusId)
      const movedStatus = { ...current, category: newCategory }

      if (direction === 1) {
        const lastIdx = updated.findLastIndex((s) => s.category === newCategory)
        updated.splice(lastIdx + 1, 0, movedStatus)
      } else {
        const firstIdx = updated.findIndex((s) => s.category === newCategory)
        updated.splice(firstIdx === -1 ? targetIdx : firstIdx, 0, movedStatus)
      }

      onChange(updated)
    }
  }

  function handleAdd(category: TaskCategory) {
    if (!newName.trim()) return
    onChange([...statuses, {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color: newColor,
      category,
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
        Customize your workflow. Every stage needs at least one status; the first one in a stage is its default. Use arrows to reorder — statuses move between stages when crossing a boundary.
      </p>

      {TASK_CATEGORIES.map((category) => {
        const group = statusesForCategory(category)
        return (
          <div key={category}>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                {CATEGORY_LABELS[category]}
              </span>
              <span className="text-xs text-muted-foreground">
                {CATEGORY_DESCRIPTIONS[category]}
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

              {addingToType === category ? (
                <form
                  className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1"
                  onSubmit={(e) => { e.preventDefault(); handleAdd(category) }}
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
                  onClick={() => { setAddingToType(category); setNewName(""); setNewColor("gray") }}
                  aria-label={`Add ${CATEGORY_LABELS[category]} status`}
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
