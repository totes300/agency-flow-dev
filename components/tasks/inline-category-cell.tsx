"use client"

import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command"
import { CategoryBadge } from "@/components/category-badge"
import { getCategoryColor } from "@/convex/lib/constants"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineCategoryCell({
  taskId,
  category,
}: {
  taskId: Id<"tasks">
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
}) {
  const [open, setOpen] = useState(false)
  const categories = useQuery(api.workCategories.list, {})
  const updateTask = useMutation(api.tasks.update)

  async function handleSelect(categoryId: Id<"workCategories"> | null) {
    setOpen(false)
    try {
      await updateTask({ id: taskId, workCategoryId: categoryId })
    } catch {
      // Convex subscription reverts on failure
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center rounded-sm py-0.5 transition-colors hover:bg-muted/50"
          onClick={(e) => e.stopPropagation()}
        >
          {category ? (
            <CategoryBadge name={category.name} color={category.color} />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
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
