"use client"

import { useMemo, useRef, useState } from "react"
import { useQuery } from "convex/react"
import { ChevronDownIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

/**
 * The shared title + project form behind both in-place creation paths
 * (mockup `qc` popover and `qadd` composer). Owner feedback (2026-07-06):
 * the project picker must be SEARCHABLE (hundreds of clients — same
 * Popover+Command pattern as the /tasks inline-add project cell, grouped
 * by client), picking a project hands focus back to the title input so
 * Enter always works, and an explicit primary submit button makes the
 * create action discoverable. Escape cancels; a rejected submit keeps the
 * typed title so a failure never loses input (PRD story 35) — the caller
 * owns the error toast. Subscribes to the project list itself: the form
 * only mounts while a popover/composer is open, so the board stays light.
 */
export function PlannerCreateForm({
  submitLabel,
  onSubmit,
  onCancel,
  clearTitleOnSubmit = false,
}: {
  /** "Create task" (popover) / "Add task" (composer). */
  submitLabel: string
  /** Resolution may unmount the form (popover) or leave it open (composer). */
  onSubmit: (title: string, projectId: Id<"projects"> | null) => Promise<void>
  onCancel: () => void
  /** Composer mode: empty the title immediately for rapid capture. */
  clearTitleOnSubmit?: boolean
}) {
  const [title, setTitle] = useState("")
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const projects = useQuery(api.projects.list, {})

  const selected = projectId
    ? projects?.find((p) => p._id === projectId) ?? null
    : null

  // Group projects by client name (Toggl-style, inline-add prior art).
  const groupedProjects = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof projects>>()
    for (const p of projects ?? []) {
      const clientName = p.clientName ?? "Unknown"
      if (!groups.has(clientName)) groups.set(clientName, [])
      groups.get(clientName)!.push(p)
    }
    return groups
  }, [projects])

  const pickProject = (id: Id<"projects"> | null) => {
    setProjectId(id)
    setPickerOpen(false)
    // Focus returns to the title so Enter submits right after picking.
    inputRef.current?.focus()
  }

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    if (clearTitleOnSubmit) setTitle("")
    void onSubmit(trimmed, projectId)
      .then(() => inputRef.current?.focus())
      .catch(() => {
        // Restore the cleared title unless the user already typed the next
        // one; the toast came from the caller's mutation wrapper.
        if (clearTitleOnSubmit) {
          setTitle((current) => (current ? current : trimmed))
        }
        inputRef.current?.focus()
      })
  }

  return (
    <div
      className="flex flex-col gap-1.5"
      // The popover floats over the day canvas — a press inside the form
      // must never start a draw-to-create underneath.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Enter submits from anywhere in the form (title, picker trigger,
        // submit button); Escape cancels. The open picker is a portaled
        // Radix layer, so its own Enter/Escape never bubble here.
        if (e.key === "Enter") {
          e.preventDefault()
          submit()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task name…"
        aria-label="New task title"
        className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
      />

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Project"
            className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-border bg-card px-2.5 text-left text-[12.5px] text-foreground outline-none focus-visible:border-primary"
          >
            <span className="truncate">
              {selected ? (
                <>
                  {selected.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {selected.clientName}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">No project</span>
              )}
            </span>
            <ChevronDownIcon className="size-3.5 flex-none text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[248px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects, clients…" />
            <CommandList>
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="__none" onSelect={() => pickProject(null)}>
                  <span className="text-[13px] text-muted-foreground">
                    No project
                  </span>
                </CommandItem>
              </CommandGroup>
              {[...groupedProjects.entries()].map(
                ([clientName, clientProjects]) => (
                  <CommandGroup key={clientName} heading={clientName}>
                    {clientProjects.map((p) => (
                      <CommandItem
                        key={p._id}
                        // Search matches project AND client names.
                        value={`${p.name} ${clientName}`}
                        onSelect={() => pickProject(p._id)}
                      >
                        <span className="truncate">{p.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          className="h-7 px-3 text-[12.5px]"
          disabled={!title.trim()}
          onClick={submit}
        >
          {submitLabel}
        </Button>
        <span className="text-[10.5px] text-muted-foreground">
          esc to cancel
        </span>
      </div>
    </div>
  )
}
