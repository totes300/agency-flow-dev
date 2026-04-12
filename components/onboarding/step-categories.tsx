"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CATEGORY_COLOR_NAMES } from "@/convex/lib/constants"
import type { CategoryColor } from "@/convex/lib/constants"
import { CategoryDot } from "./shared"
import type { CategoryDraft } from "./shared"
import {
  PlusIcon,
  XIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "lucide-react"

export function StepCategories({
  categories,
  onChange,
}: {
  categories: CategoryDraft[]
  onChange: (c: CategoryDraft[]) => void
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState<CategoryColor>("blue")

  function handleRemove(id: string) {
    onChange(categories.filter((c) => c.id !== id))
  }

  function handleMove(index: number, direction: -1 | 1) {
    const next = [...categories]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  function handleEdit(id: string, field: Partial<CategoryDraft>) {
    onChange(categories.map((c) => (c.id === id ? { ...c, ...field } : c)))
  }

  function handleRateChange(id: string, value: string) {
    const num = Number(value)
    if (value && num < 0) return
    handleEdit(id, { defaultBillRate: value })
  }

  function handleAdd() {
    if (!newName.trim()) return
    onChange([
      ...categories,
      {
        id: crypto.randomUUID(),
        name: newName.trim(),
        color: newColor,
        defaultBillRate: "",
      },
    ])
    setNewName("")
    setNewColor("blue")
    setAddingNew(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Work categories like Design, Development, PM. Used for task classification and billing rates.
      </p>

      <div className="space-y-1">
        {categories.map((cat, index) => (
          <div key={cat.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
            <div className="relative">
              <CategoryDot color={cat.color} />
              <select
                className="absolute inset-0 cursor-pointer opacity-0"
                value={cat.color}
                onChange={(e) => handleEdit(cat.id, { color: e.target.value as CategoryColor })}
                aria-label="Category color"
              >
                {CATEGORY_COLOR_NAMES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <Input
              value={cat.name}
              onChange={(e) => handleEdit(cat.id, { name: e.target.value })}
              aria-label={`Category name for ${cat.name || "new category"}`}
              className="h-7 flex-1 border-transparent bg-transparent px-1 text-sm hover:border-input focus:border-input"
            />

            <Input
              type="number"
              min={0}
              step="any"
              value={cat.defaultBillRate}
              onChange={(e) => handleRateChange(cat.id, e.target.value)}
              aria-label={`Bill rate for ${cat.name || "new category"}`}
              placeholder="Bill rate"
              className="h-7 w-20 px-1 text-xs"
            />

            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleMove(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleMove(index, 1)}
                disabled={index === categories.length - 1}
                aria-label="Move down"
              >
                <ArrowDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(cat.id)}
                aria-label="Remove"
              >
                <XIcon />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {addingNew ? (
        <form
          className="flex items-center gap-2 rounded-md border px-2 py-1.5"
          onSubmit={(e) => { e.preventDefault(); handleAdd() }}
        >
          <CategoryDot color={newColor} />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name"
            className="h-7 flex-1 border-transparent bg-transparent px-1 text-sm"
            autoFocus
          />
          <Button size="xs" variant="ghost" type="submit">
            Add
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            onClick={() => setAddingNew(false)}
            aria-label="Cancel"
          >
            <XIcon />
          </Button>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddingNew(true)}
        >
          <PlusIcon />
          Add Category
        </Button>
      )}
    </div>
  )
}
