"use client"

import { useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import {
  EMPTY_FACETS,
  type CloseFacetKey,
  type CloseFacets,
} from "@/lib/billing/close-queue-filters"

const PARAM: Record<CloseFacetKey, string> = {
  client: "client",
  billingType: "type",
  readiness: "readiness",
}

function parseList(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : []
}

/**
 * Close-queue facet state, persisted in the URL (PRD slice 08 — URL-persisted,
 * no default filter). Reads `?client=`, `?type=`, `?readiness=` and writes them
 * back on toggle, so filters survive reload and are shareable.
 */
export function useCloseFacets(): {
  facets: CloseFacets
  toggleValue: (facet: CloseFacetKey, value: string) => void
  clearFacet: (facet: CloseFacetKey) => void
  clearAll: () => void
} {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const facets: CloseFacets = {
    client: parseList(searchParams.get(PARAM.client)),
    billingType: parseList(searchParams.get(PARAM.billingType)),
    readiness: parseList(searchParams.get(PARAM.readiness)),
  }

  const write = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, router, searchParams],
  )

  const toggleValue = useCallback(
    (facet: CloseFacetKey, value: string) => {
      write((params) => {
        const current = parseList(params.get(PARAM[facet]))
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value]
        if (next.length > 0) params.set(PARAM[facet], next.join(","))
        else params.delete(PARAM[facet])
      })
    },
    [write],
  )

  const clearFacet = useCallback(
    (facet: CloseFacetKey) => write((params) => params.delete(PARAM[facet])),
    [write],
  )

  const clearAll = useCallback(
    () =>
      write((params) => {
        params.delete(PARAM.client)
        params.delete(PARAM.billingType)
        params.delete(PARAM.readiness)
        params.delete("search")
      }),
    [write],
  )

  return { facets: facets ?? EMPTY_FACETS, toggleValue, clearFacet, clearAll }
}
