"use client"

import { useState, type ReactNode } from "react"
import { CheckIcon, ListFilter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { activeFacetCount, facetOptions, type FacetDef, type FacetState } from "@/lib/billing/hub-facets"

/**
 * The hub's "+ Filter" (Notion three-step: pick a facet → pick values), with
 * cross-filtered counts — the Close queue's filter, generalised over facet
 * definitions. No default filter, no permanent chips.
 */
export function FacetFilterButton<R>({
  rows,
  defs,
  state,
  icons,
  onToggle,
}: {
  rows: readonly R[]
  defs: readonly FacetDef<R>[]
  state: FacetState
  icons?: Record<string, ReactNode>
  onToggle: (key: string, value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [facet, setFacet] = useState<string | null>(null)
  const active = activeFacetCount(state)
  const def = facet ? defs.find((d) => d.key === facet) : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTimeout(() => setFacet(null), 200)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          className={cn("h-[30px] rounded-full", active > 0 && "border-primary/20 bg-primary/8 text-primary")}
        >
          <ListFilter className="size-3.5" />
          {active > 0 ? active : "Filter"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder={def ? def.label : "Filter…"} className="h-9" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {def ? (
              <CommandGroup>
                {facetOptions(rows, defs, state, def.key).map((opt) => {
                  const selected = (state[def.key] ?? []).includes(opt.id)
                  return (
                    <CommandItem
                      key={opt.id}
                      value={`${opt.name} ${opt.id}`}
                      onSelect={() => onToggle(def.key, opt.id)}
                      className="flex items-center gap-2"
                    >
                      <CheckIcon className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{opt.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{opt.count}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : (
              <CommandGroup>
                {defs.map((d) => (
                  <CommandItem
                    key={d.key}
                    value={d.label}
                    onSelect={() => setFacet(d.key)}
                    className="flex items-center gap-2 text-muted-foreground"
                  >
                    {icons?.[d.key]}
                    <span className="text-accent-foreground">{d.label}</span>
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

/** One pill per selected value (click removes it) + Clear. */
export function ActiveFacetPills<R>({
  rows,
  defs,
  state,
  onToggle,
  onClear,
}: {
  rows: readonly R[]
  defs: readonly FacetDef<R>[]
  state: FacetState
  onToggle: (key: string, value: string) => void
  onClear: () => void
}) {
  const pills = defs.flatMap((d) =>
    (state[d.key] ?? []).map((value) => ({ key: d.key, value, label: d.label, name: d.nameOf?.(value, rows) ?? value })),
  )
  if (pills.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3">
      {pills.map((p) => (
        <button
          key={`${p.key}:${p.value}`}
          type="button"
          onClick={() => onToggle(p.key, p.value)}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        >
          <span className="font-medium text-foreground/80">{p.label}:</span>
          {p.name}
          <span aria-hidden>×</span>
        </button>
      ))}
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
