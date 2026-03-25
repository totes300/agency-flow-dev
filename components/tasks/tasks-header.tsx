"use client"

import { useState, useEffect, useRef } from "react"
import { PlusIcon, SearchIcon, XIcon } from "lucide-react"
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
  const [localSearch, setLocalSearch] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  function handleChange(value: string) {
    setLocalSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearchChange(value)
    }, 300)
  }

  function handleClear() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setLocalSearch("")
    onSearchChange("")
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">All Tasks</h1>
      <div className="flex items-center gap-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={localSearch}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search..."
            className="h-8 w-48 pl-8 pr-7 text-[13px]"
          />
          {localSearch && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        <Button size="sm" className="h-8 text-[13px]" onClick={onNewTask}>
          <PlusIcon className="size-3.5" />
          New task
        </Button>
      </div>
    </div>
  )
}
