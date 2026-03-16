"use client"

import { PlusIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function TasksHeader({
  search,
  onSearchChange,
  onNewTask,
  totalCount,
}: {
  search: string
  onSearchChange: (value: string) => void
  onNewTask: () => void
  totalCount?: number
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-muted-foreground">Tasks</p>
        <h1 className="text-2xl font-bold tracking-tight">
          All Tasks
          {totalCount !== undefined && (
            <span className="ml-2 text-lg font-normal text-muted-foreground">
              {totalCount}
            </span>
          )}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search or add filter..."
            className="w-64 pl-9"
          />
        </div>
        <Button onClick={onNewTask}>
          <PlusIcon className="size-4" />
          New task
        </Button>
      </div>
    </div>
  )
}
