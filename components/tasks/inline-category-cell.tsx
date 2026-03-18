"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command"
import { CategoryBadge } from "@/components/category-badge"
import { cn } from "@/lib/utils"
import { getCategoryColor } from "@/convex/lib/constants"
import { TagIcon } from "lucide-react"
import { toastError } from "@/lib/toast-helpers"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineCategoryCell({
  taskId,
  category,
  onSelect: onSelectProp,
}: {
  taskId?: Id<"tasks">
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  onSelect?: (categoryId: Id<"workCategories"> | null, category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null) => void
}) {
  const [open, setOpen] = useState(false)
  const { categories } = useTaskReferenceData()
  const updateTask = useMutation(api.tasks.update)

  async function handleSelect(categoryId: Id<"workCategories"> | null) {
    setOpen(false)
    if (onSelectProp) {
      const c = categoryId ? categories?.find((cat) => cat._id === categoryId) : null
      onSelectProp(categoryId, c ? { _id: c._id, name: c.name, color: c.color } : null)
      return
    }
    if (!taskId) return
    try {
      await updateTask({ id: taskId, workCategoryId: categoryId })
    } catch (err) {
      toastError(err, "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("flex w-full items-center rounded-sm py-0.5 transition-colors", category && "hover:bg-muted/50")}
          onClick={(e) => e.stopPropagation()}
        >
          {category ? (
            <CategoryBadge name={category.name} color={category.color} />
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground/20 transition-colors group-hover/row:text-muted-foreground/50">
              <TagIcon className="size-3.5" />
              <span className="text-xs">Category</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search category..." />
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => handleSelect(null)}>
                <span className="text-muted-foreground">None</span>
              </CommandItem>
              {categories?.map((c) => {
                const colors = getCategoryColor(c.color)
                return (
                  <CommandItem key={c._id} onSelect={() => handleSelect(c._id)}>
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.text}30` }}
                    />
                    <span className="truncate">{c.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
