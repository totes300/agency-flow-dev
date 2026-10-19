"use client"

import { useEffect, useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export const MERGE_SEARCH_DEBOUNCE_MS = 250

/**
 * `Merge into…` (docs/prd-email-triage.md D29; B8b): a picker of the client's
 * open top-level tasks (`email/triageView.mergeCandidates` — the same-client
 * rule `mergeInto` enforces), searched on the server as you type (debounced).
 * Picking one merges; the server builds the change proposal on that task.
 */
export function MergePicker({
  itemId,
  clientName,
  open,
  onOpenChange,
  onPick,
  children,
}: {
  itemId: Id<"agentItems">
  clientName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (task: { _id: Id<"tasks">; identifier: string }) => void
  /** The trigger button. */
  children: React.ReactNode
}) {
  const [input, setInput] = useState("")
  const [search, setSearch] = useState("")
  // The typed text reaches the server after a short pause (it searches titles).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), MERGE_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])
  const candidates = useQuery(
    api.email.triageView.mergeCandidates,
    open ? (search ? { itemId, search } : { itemId }) : "skip",
  )
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setInput("")
          setSearch("")
        }
        onOpenChange(next)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {/* The server already filtered: cmdk must not filter the results again. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder={clientName ? `Merge into a ${clientName} task…` : "Merge into a task…"}
          />
          <CommandList>
            <CommandEmpty>
              {candidates === undefined
                ? "Loading…"
                : !clientName
                  ? "No client on this email yet."
                  : search
                    ? "No open task matches."
                    : "No open task of this client."}
            </CommandEmpty>
            {candidates && candidates.length > 0 && (
              <CommandGroup heading="Open tasks">
                {candidates.map((task) => (
                  <CommandItem
                    key={task._id}
                    value={`${task.identifier} ${task.title}`}
                    onSelect={() => {
                      onOpenChange(false)
                      onPick({ _id: task._id, identifier: task.identifier })
                    }}
                  >
                    <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{task.identifier}</span>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    {task.status && <span className="shrink-0 text-xs text-muted-foreground">{task.status}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
