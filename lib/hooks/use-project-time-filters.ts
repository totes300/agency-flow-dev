"use client"

/**
 * URL-backed filter state for the project Time tab's Notion-style facets.
 *
 * The generic filter engine (`components/ui/filters.tsx`) works against a
 * `Dispatch<SetStateAction<Filter[]>>`; this hook provides one whose store
 * is the `?filters=` search param (codec in `lib/time-entry-filters.ts`),
 * keeping the tab's "filterable views persist state in URL" convention —
 * back button, shareable links, refresh all preserve the filter set.
 */

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Dispatch, SetStateAction } from "react"
import type { Filter } from "@/lib/filter-types"
import {
  parseTimeEntryFilters,
  serializeTimeEntryFilters,
} from "@/lib/time-entry-filters"

export function useProjectTimeFilters(): {
  filters: Filter[]
  setFilters: Dispatch<SetStateAction<Filter[]>>
} {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const filters = useMemo(
    () => parseTimeEntryFilters(searchParams.get("filters")),
    [searchParams],
  )

  const setFilters: Dispatch<SetStateAction<Filter[]>> = useCallback(
    (updater) => {
      const current = parseTimeEntryFilters(searchParams.get("filters"))
      const next = typeof updater === "function" ? updater(current) : updater
      const params = new URLSearchParams(searchParams.toString())
      const serialized = serializeTimeEntryFilters(next)
      if (serialized) params.set("filters", serialized)
      else params.delete("filters")
      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname)
    },
    [searchParams, router, pathname],
  )

  return { filters, setFilters }
}
