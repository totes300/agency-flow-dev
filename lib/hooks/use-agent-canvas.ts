"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Canvas open/expand state for the Agents workspace (slice 06), stored in the
 * URL so it survives refresh, back/forward, and thread revisits — and so the
 * artifact block (which opens the canvas) and the canvas panel (which reads /
 * closes / expands it) share one source of truth.
 *
 *   ?artifact=<id>  → canvas open on that artifact (absent → closed)
 *   ?canvas=wide    → expanded to the wide layout
 *
 * All updates use `router.replace` (no history spam — the canvas is a viewer,
 * not navigation) and preserve every other param (thread, agent, view).
 */
export function useAgentCanvas() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const artifactId = searchParams.get("artifact")
  const isExpanded = searchParams.get("canvas") === "wide"

  const replaceWith = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
    [router, pathname, searchParams],
  )

  const openArtifact = useCallback(
    (id: string) => {
      replaceWith((params) => params.set("artifact", id))
    },
    [replaceWith],
  )

  const closeCanvas = useCallback(() => {
    replaceWith((params) => {
      params.delete("artifact")
      params.delete("canvas")
    })
  }, [replaceWith])

  const setExpanded = useCallback(
    (expanded: boolean) => {
      replaceWith((params) => {
        if (expanded) params.set("canvas", "wide")
        else params.delete("canvas")
      })
    },
    [replaceWith],
  )

  return { artifactId, isExpanded, openArtifact, closeCanvas, setExpanded }
}
