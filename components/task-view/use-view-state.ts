"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { ListViewSurface, TaskViewSpec } from "@/convex/tasks/model"
import {
  VIEW_PARAM,
  baseSpecFor,
  isSpecModified,
  resolveViewKey,
  specFromSearchParams,
  systemViewsFor,
  toSearchString,
  writeViewParams,
  type ViewOverrides,
} from "@/components/task-view/view-state"

/**
 * The view state of a task surface, bound to the URL (§4.4, §6.1):
 * `viewKey` from `?view=`, `spec` = that view's spec + the URL overrides,
 * `modified` when they differ. Switching views pushes a history entry and
 * drops the previous view's overrides; display changes replace the entry.
 */
export function useViewState(surface: ListViewSurface) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const viewKey = resolveViewKey(surface, searchParams.get(VIEW_PARAM))
  const baseSpec = baseSpecFor(surface, viewKey)
  const views = useMemo(() => systemViewsFor(surface), [surface])

  const paramsKey = searchParams.toString()
  const spec = useMemo(
    () => specFromSearchParams(new URLSearchParams(paramsKey), baseSpec),
    [paramsKey, baseSpec],
  )
  const modified = isSpecModified(spec, baseSpec)

  const navigate = useCallback(
    (next: URLSearchParams, mode: "push" | "replace") => {
      const href = `${pathname}${toSearchString(next)}`
      if (mode === "push") router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router],
  )

  const setView = useCallback(
    (key: string) => {
      if (key === viewKey) return
      const current = new URLSearchParams(paramsKey)
      navigate(writeViewParams(current, surface, key, baseSpecFor(surface, key)), "push")
    },
    [navigate, paramsKey, surface, viewKey],
  )

  const updateSpec = useCallback(
    (patch: ViewOverrides) => {
      const current = new URLSearchParams(paramsKey)
      const next: TaskViewSpec = { ...spec, ...patch }
      navigate(writeViewParams(current, surface, viewKey, next), "replace")
    },
    [navigate, paramsKey, spec, surface, viewKey],
  )

  const reset = useCallback(() => {
    navigate(writeViewParams(new URLSearchParams(paramsKey), surface, viewKey, baseSpec), "replace")
  }, [baseSpec, navigate, paramsKey, surface, viewKey])

  return { surface, viewKey, views, baseSpec, spec, modified, setView, updateSpec, reset }
}

export type ViewState = ReturnType<typeof useViewState>
