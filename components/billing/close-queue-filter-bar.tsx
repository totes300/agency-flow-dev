"use client"

import { useMemo, useState } from "react"
import { ListFilter, Building2, CircleDot, CheckIcon } from "lucide-react"
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
import { cn } from "@/lib/utils"
import {
  facetCounts,
  hasActiveFacets,
  READINESS_OPTIONS,
  type CloseFacetKey,
  type CloseFacets,
} from "@/lib/billing/close-queue-filters"
import type { CloseQueueRow } from "@/convex/billingViews"

const FACET_LABEL: Record<CloseFacetKey, string> = {
  client: "Client",
  billingType: "Billing type",
  readiness: "Readiness",
}

const BILLING_TYPE_LABEL: Record<string, string> = {
  retainer: "Retainer",
  t_and_m: "T&M",
  fixed: "Fixed",
  non_billable: "Non-billable",
}

type Option = { id: string; name: string; count: number }

/**
 * The Close-queue "+ Filter" popover (Notion three-step: pick facet → pick
 * values). Options carry cross-filtered counts (each menu reflects the other
 * active facets + search). Toggling a value writes through to the URL via the
 * facet hook. No default filter, no permanent chips.
 */
export function CloseQueueFilterBar({
  rows,
  facets,
  search,
  toggleValue,
}: {
  rows: CloseQueueRow[]
  facets: CloseFacets
  search: string
  toggleValue: (facet: CloseFacetKey, value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [selectedFacet, setSelectedFacet] = useState<CloseFacetKey | null>(null)

  // Build option lists with cross-filtered counts for the active facet step.
  const options = useMemo<Record<CloseFacetKey, Option[]>>(() => {
    const clientCounts = facetCounts(rows, "client", facets, search)
    const typeCounts = facetCounts(rows, "billingType", facets, search)
    const readinessCounts = facetCounts(rows, "readiness", facets, search)

    const clientNameById = new Map<string, string>()
    for (const r of rows) clientNameById.set(r.clientId, r.clientName)

    const toOptions = (
      counts: Map<string, number>,
      name: (id: string) => string,
    ): Option[] =>
      [...counts.entries()]
        .map(([id, count]) => ({ id, name: name(id), count }))
        .sort((a, b) => a.name.localeCompare(b.name))

    return {
      client: toOptions(clientCounts, (id) => clientNameById.get(id) ?? "Unknown"),
      billingType: toOptions(
        typeCounts,
        (id) => BILLING_TYPE_LABEL[id] ?? id,
      ),
      readiness: READINESS_OPTIONS.map((o) => ({
        id: o.id,
        name: o.name,
        count: readinessCounts.get(o.id) ?? 0,
      })),
    }
  }, [rows, facets, search])

  const active = hasActiveFacets(facets)
  const activeCount =
    facets.client.length + facets.billingType.length + facets.readiness.length

  function reset() {
    setTimeout(() => setSelectedFacet(null), 200)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          size="sm"
          className={cn(
            "group flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs transition-colors",
            active
              ? "border-primary/15 bg-primary/8 text-primary/70 hover:border-primary/20 hover:bg-primary/12 hover:text-primary/80"
              : "text-muted-foreground/85 hover:border-border/80 hover:bg-muted/55 hover:text-foreground",
          )}
        >
          <ListFilter className="size-3 shrink-0" />
          {active ? activeCount : "Filter"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: "220px" }}>
        <Command>
          <CommandInput
            placeholder={selectedFacet ? FACET_LABEL[selectedFacet] : "Filter…"}
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {selectedFacet ? (
              <CommandGroup>
                {options[selectedFacet].map((opt) => {
                  const selected = facets[selectedFacet].includes(opt.id)
                  return (
                    <CommandItem
                      key={opt.id}
                      value={opt.name}
                      onSelect={() => toggleValue(selectedFacet, opt.id)}
                      className="flex items-center gap-2"
                    >
                      <CheckIcon
                        className={cn(
                          "size-3.5",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate text-accent-foreground">
                        {opt.name}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {opt.count}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : (
              <CommandGroup>
                <CommandItem
                  value="Client"
                  onSelect={() => setSelectedFacet("client")}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <Building2 className="size-3.5" />
                  <span className="text-accent-foreground">Client</span>
                </CommandItem>
                <CommandItem
                  value="Billing type"
                  onSelect={() => setSelectedFacet("billingType")}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <CircleDot className="size-3.5" />
                  <span className="text-accent-foreground">Billing type</span>
                </CommandItem>
                <CommandItem
                  value="Readiness"
                  onSelect={() => setSelectedFacet("readiness")}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <CheckIcon className="size-3.5" />
                  <span className="text-accent-foreground">Readiness</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Active-facet pills (second toolbar row) — one per selected value, click to remove. */
export function CloseQueueActiveFacets({
  rows,
  facets,
  toggleValue,
  clearAll,
  hasSearch,
}: {
  rows: CloseQueueRow[]
  facets: CloseFacets
  toggleValue: (facet: CloseFacetKey, value: string) => void
  clearAll: () => void
  hasSearch: boolean
}) {
  const clientNameById = new Map<string, string>()
  for (const r of rows) clientNameById.set(r.clientId, r.clientName)

  const pills: { facet: CloseFacetKey; value: string; label: string }[] = []
  for (const value of facets.client) {
    pills.push({ facet: "client", value, label: clientNameById.get(value) ?? "Unknown" })
  }
  for (const value of facets.billingType) {
    pills.push({ facet: "billingType", value, label: BILLING_TYPE_LABEL[value] ?? value })
  }
  for (const value of facets.readiness) {
    const opt = READINESS_OPTIONS.find((o) => o.id === value)
    pills.push({ facet: "readiness", value, label: opt?.name ?? value })
  }

  if (pills.length === 0 && !hasSearch) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pills.map((p) => (
        <button
          key={`${p.facet}:${p.value}`}
          type="button"
          onClick={() => toggleValue(p.facet, p.value)}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <span className="font-medium text-foreground/80">{FACET_LABEL[p.facet]}:</span>
          {p.label}
          <span aria-hidden>×</span>
        </button>
      ))}
      {(pills.length > 0 || hasSearch) && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-md border-border bg-background text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          onClick={clearAll}
        >
          Clear
        </Button>
      )}
    </div>
  )
}
