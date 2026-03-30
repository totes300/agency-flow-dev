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
import { TagIcon } from "lucide-react"
import { toastError } from "@/lib/toast-helpers"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineCategoryCell({
  taskId,
  category,
  onSelect: onSelectProp,
  emptyLabel,
}: {
  taskId?: Id<"tasks">
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  onSelect?: (categoryId: Id<"workCategories"> | null, category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null) => void
  emptyLabel?: string
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
          className={cn("flex w-full items-center rounded-sm py-0.5 transition-colors", category && "hover:bg-accent")}
          onClick={(e) => e.stopPropagation()}
        >
          {category ? (
            <CategoryBadge name={category.name} color={category.color} />
          ) : (
            <span className="flex items-center gap-1.5 rounded-md border border-dashed border-border/55 bg-muted/[0.12] px-2 py-1 text-muted-foreground/60 transition-colors group-hover/row:border-border/80 group-hover/row:bg-muted/[0.22] group-hover/row:text-muted-foreground">
              <TagIcon className="size-4 shrink-0" strokeWidth={1.75} />
              {emptyLabel && <span className="text-[13px]">{emptyLabel}</span>}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search category..." />
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => handleSelect(null)} className="px-2 py-1.5">
                <span className="text-[13px] text-muted-foreground">None</span>
              </CommandItem>
              {categories?.map((c) => (
                  <CommandItem key={c._id} onSelect={() => handleSelect(c._id)} className="px-2 py-1.5">
                    <CategoryBadge name={c.name} color={c.color} />
                  </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
