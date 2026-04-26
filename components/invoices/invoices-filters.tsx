"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  InvoicesFilterBar,
  InvoicesActiveFilters,
} from "@/components/invoices/invoices-filter-bar"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import type { Filter } from "@/components/ui/filters"

type StatusTab = "all" | "draft" | "invoiced" | "paid" | "void"

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
]

/**
 * Status tab + `+ Filter` trigger + search on row 1; active filter pills on
 * row 2 (only when filters exist, so the bar collapses cleanly on an empty
 * view). Filter state is owned by the page (React state) and passed in —
 * this component is purely presentational for the bar layout.
 */
export function InvoicesFilters({
  filters,
  setFilters,
}: {
  filters: Filter[]
  setFilters: (updater: Filter[] | ((prev: Filter[]) => Filter[])) => void
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeStatus = (searchParams.get("status") as StatusTab | null) ?? "all"
  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

  function setStatus(value: StatusTab) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "all") {
      params.delete("status")
    } else {
      params.set("status", value)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={activeStatus}
          onValueChange={(v) => setStatus(v as StatusTab)}
        >
          <TabsList variant="line">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <InvoicesFilterBar filters={filters} setFilters={setFilters} />

        <div className="relative ml-auto w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoice number or subject"
            aria-label="Search invoices"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <InvoicesActiveFilters filters={filters} setFilters={setFilters} />
    </div>
  )
}
